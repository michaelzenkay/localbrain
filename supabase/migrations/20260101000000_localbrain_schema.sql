create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists brains (
  id text primary key,
  display_name text not null,
  purpose text not null,
  profile_path text,
  created_at timestamptz default now()
);

insert into brains (id, display_name, purpose, profile_path)
values
  ('localbrain', 'Local Brain', 'Default personal memory namespace.', null),
  ('work', 'Work', 'Optional work-related memory namespace.', null),
  ('research', 'Research', 'Optional research memory namespace.', null),
  ('journal', 'Journal', 'Optional reflective journal namespace.', null)
on conflict (id) do update
set display_name = excluded.display_name,
    purpose = excluded.purpose,
    profile_path = excluded.profile_path;

create table if not exists thoughts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1024),
  metadata jsonb default '{}',
  content_fingerprint text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists thoughts_embedding_idx
  on thoughts using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists thoughts_created_at_idx on thoughts (created_at desc);
create index if not exists thoughts_updated_at_idx on thoughts (updated_at desc);
create index if not exists thoughts_metadata_idx on thoughts using gin (metadata);
create index if not exists thoughts_brain_id_idx on thoughts ((metadata->>'brain_id'));
create unique index if not exists thoughts_content_fingerprint_idx
  on thoughts (content_fingerprint, ((metadata->>'brain_id')))
  where content_fingerprint is not null;

create or replace function localbrain_content_fingerprint(content text)
returns text
language sql immutable
as $$
  select encode(
    digest(lower(trim(regexp_replace(coalesce(content, ''), '\s+', ' ', 'g'))), 'sha256'),
    'hex'
  );
$$;

create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists thoughts_updated_at on thoughts;
create trigger thoughts_updated_at
  before update on thoughts
  for each row
  execute function update_updated_at();

create or replace function upsert_thought(
  p_content text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_fingerprint text;
  v_brain_id text;
  v_id uuid;
begin
  v_fingerprint := localbrain_content_fingerprint(p_content);
  v_brain_id := coalesce(p_metadata->>'brain_id', 'localbrain');

  insert into thoughts (content, metadata, content_fingerprint)
  values (
    p_content,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('brain_id', v_brain_id),
    v_fingerprint
  )
  on conflict (content_fingerprint, ((metadata->>'brain_id'))) where content_fingerprint is not null do update
  set metadata = thoughts.metadata || coalesce(excluded.metadata, '{}'::jsonb)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
end;
$$;

create or replace function match_thoughts(
  query_embedding vector(1024),
  query_text text default '',
  match_threshold float default 0.5,
  match_count int default 10,
  brain_id text default null
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    metadata,
    created_at,
    1 - (embedding <=> query_embedding) as similarity
  from thoughts
  where 1 - (embedding <=> query_embedding) > match_threshold
    and (brain_id is null or metadata->>'brain_id' = brain_id)
  order by embedding <=> query_embedding
  limit match_count;
$$;

alter table thoughts enable row level security;
alter table brains enable row level security;

drop policy if exists "Service role full access" on thoughts;
create policy "Service role full access"
  on thoughts
  for all
  using (auth.role() = 'service_role');

drop policy if exists "Service role read namespaces" on brains;
create policy "Service role read namespaces"
  on brains
  for select
  using (auth.role() = 'service_role');

grant select, insert, update, delete on table public.thoughts to service_role;
grant select on table public.brains to service_role;
grant execute on function public.localbrain_content_fingerprint(text) to service_role;
grant execute on function public.match_thoughts(vector, text, float, int, text) to service_role;
grant execute on function public.upsert_thought(text, jsonb) to service_role;
