-- Forward-only follow-up for project-document tenant isolation.
-- This migration preserves rows and does not change bucket visibility.

drop policy if exists project_documents_delete_authorized on public.project_documents;
create policy project_documents_delete_authorized on public.project_documents
for delete to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        uploaded_by = (select auth.uid())
        or p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
);

drop policy if exists project_documents_authorized_update on storage.objects;
revoke update on storage.objects from authenticated;
