-- Forward-only authorization corrections for project documents and research.
-- This migration preserves rows and does not change bucket visibility.

drop policy if exists project_documents_access on public.project_documents;
create policy project_documents_access on public.project_documents
for select to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists project_documents_insert_authorized on public.project_documents;
create policy project_documents_insert_authorized on public.project_documents
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
      )
  )
);

revoke insert, update, delete on public.project_documents from authenticated;
grant insert, delete on public.project_documents to authenticated;

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
        or
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
);

drop policy if exists project_documents_owner_upload on storage.objects;
create policy project_documents_owner_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'project-documents'
  and (storage.foldername(name))[1] = 'projects'
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and exists (
    select 1
    from public.projects p
    where p.id::text = (storage.foldername(name))[2]
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists project_documents_owner_delete on storage.objects;
create policy project_documents_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'project-documents'
  and exists (
    select 1
    from public.project_documents d
    join public.projects p on p.id = d.project_id
    where d.storage_bucket = bucket_id
      and d.storage_path = name
      and p.institution_id = private.current_institution_id()
      and (
        d.uploaded_by = (select auth.uid())
        or p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
);

drop policy if exists project_documents_authorized_update on storage.objects;
-- Replacement is intentionally unsupported. Uploads use unique immutable paths,
-- and metadata/storage deletion are authorized separately below.
revoke update on storage.objects from authenticated;

drop policy if exists research_workspace_access on public.research_workspaces;
create policy research_workspace_access on public.research_workspaces
for all to authenticated
using (
  institution_id = private.current_institution_id()
  and (
    owner_id = (select auth.uid())
    or private.is_institution_admin(institution_id)
    or exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.institution_id = institution_id
        and p.guide_id = (select auth.uid())
    )
  )
)
with check (
  owner_id = (select auth.uid())
  and institution_id = private.current_institution_id()
);

drop policy if exists research_sources_access on public.research_sources;
create policy research_sources_access on public.research_sources
for all to authenticated
using (
  exists (
    select 1
    from public.research_workspaces w
    where w.id = workspace_id
      and w.institution_id = private.current_institution_id()
      and (
        w.owner_id = (select auth.uid())
        or private.is_institution_admin(w.institution_id)
        or exists (
          select 1
          from public.projects p
          where p.id = w.project_id
            and p.institution_id = w.institution_id
            and p.guide_id = (select auth.uid())
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.research_workspaces w
    where w.id = workspace_id
      and w.institution_id = private.current_institution_id()
      and w.owner_id = (select auth.uid())
  )
);
