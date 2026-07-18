-- Least-privilege database access for the public LocalBrain MCP function.
-- The Edge Function uses the local anon key; captures go through one narrowly
-- scoped SECURITY DEFINER function, while direct update/delete remain denied.

alter table public.thoughts enable row level security;
alter table public.brains enable row level security;

revoke create on schema public from public;
revoke all on table public.thoughts from anon, authenticated;
revoke all on table public.brains from anon, authenticated;

grant select on table public.thoughts to anon;
grant select on table public.brains to anon;

drop policy if exists "Anon read thoughts" on public.thoughts;
create policy "Anon read thoughts"
  on public.thoughts
  for select
  to anon
  using (true);

drop policy if exists "Anon read namespaces" on public.brains;
create policy "Anon read namespaces"
  on public.brains
  for select
  to anon
  using (true);

revoke execute on function public.localbrain_content_fingerprint(text) from public, anon, authenticated;
revoke execute on function public.upsert_thought(text, jsonb) from public, anon, authenticated;
revoke execute on function public.match_thoughts(vector, text, float, int, text) from public, authenticated;
grant execute on function public.match_thoughts(vector, text, float, int, text) to anon;

create or replace function public.upsert_thought(
  p_content text,
  p_embedding vector(1024),
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_fingerprint text;
  v_brain_id text;
  v_id uuid;
begin
  if p_content is null or length(p_content) < 1 or length(p_content) > 50000 then
    raise exception 'content must contain between 1 and 50000 characters';
  end if;
  if p_embedding is null then
    raise exception 'embedding is required';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be a JSON object';
  end if;

  v_brain_id := coalesce(nullif(p_metadata->>'brain_id', ''), 'localbrain');
  if length(v_brain_id) > 100 or not exists (select 1 from public.brains where id = v_brain_id) then
    raise exception 'unknown or invalid namespace';
  end if;
  v_fingerprint := public.localbrain_content_fingerprint(p_content);

  insert into public.thoughts (content, embedding, metadata, content_fingerprint)
  values (
    p_content,
    p_embedding,
    p_metadata || jsonb_build_object('brain_id', v_brain_id),
    v_fingerprint
  )
  on conflict (content_fingerprint, ((metadata->>'brain_id')))
    where content_fingerprint is not null
  do update set
    embedding = excluded.embedding,
    metadata = public.thoughts.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'fingerprint', v_fingerprint);
end;
$$;

revoke execute on function public.upsert_thought(text, vector, jsonb) from public, authenticated;
grant execute on function public.upsert_thought(text, vector, jsonb) to anon;
