create or replace function public.persist_chat_turn(
  p_owner_id uuid,
  p_session_id uuid,
  p_user_content text,
  p_assistant_content text,
  p_assistant_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assistant_id uuid;
  v_timestamp timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_owner_id is null then
    raise exception 'AI service authorization required' using errcode = '42501';
  end if;

  if p_user_content is null or length(btrim(p_user_content)) not between 1 and 12000
    or p_assistant_content is null or length(btrim(p_assistant_content)) not between 1 and 20000
    or p_assistant_metadata is null or jsonb_typeof(p_assistant_metadata) <> 'object' then
    raise exception 'Invalid chat turn' using errcode = '22023';
  end if;

  perform 1
  from public.chat_sessions s
  where s.id = p_session_id and s.owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'Conversation not found or not accessible' using errcode = '42501';
  end if;

  insert into public.chat_messages (session_id, role, content, metadata, created_at)
  values (p_session_id, 'user', p_user_content, '{}'::jsonb, v_timestamp);

  insert into public.chat_messages (session_id, role, content, metadata, created_at)
  values (p_session_id, 'assistant', p_assistant_content, p_assistant_metadata, v_timestamp + interval '1 microsecond')
  returning id into v_assistant_id;

  update public.chat_sessions
  set updated_at = v_timestamp + interval '2 microseconds'
  where id = p_session_id and owner_id = p_owner_id;

  return v_assistant_id;
end;
$$;

revoke all on function public.persist_chat_turn(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_chat_turn(uuid, uuid, text, text, jsonb) to service_role;
