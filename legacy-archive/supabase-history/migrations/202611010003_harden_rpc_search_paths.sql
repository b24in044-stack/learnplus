alter function public.create_profile_for_auth_user() set search_path = '';
alter function public.publish_assessment(uuid, text, text, text, integer, integer, jsonb) set search_path = '';
alter function public.submit_assessment(uuid, jsonb, integer, uuid) set search_path = '';
alter function public.current_app_role() set search_path = '';
alter function public.can_access_course(uuid) set search_path = '';
