-- Storage RLS evaluates this parser as the authenticated upload owner.
-- It only extracts a course UUID from the object path; course access remains
-- enforced by private.can_manage_course in the Storage policies.
grant execute on function private.course_id_from_storage_path(text) to authenticated;
