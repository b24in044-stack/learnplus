-- Additive tenant-isolation corrections for project and research child records.
-- This migration does not assign records or change existing data.

drop policy if exists project_documents_access on public.project_documents;
create policy project_documents_access on public.project_documents for all to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
)
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
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
);

revoke update on public.project_documents from authenticated;

drop policy if exists project_milestone_history_access on public.project_milestone_history;
create policy project_milestone_history_access on public.project_milestone_history for select to authenticated
using (
  exists (
    select 1
    from public.project_milestones m
    join public.projects p on p.id = m.project_id
    where m.id = milestone_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id and pm.student_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists project_children_access on public.project_milestones;
create policy project_children_access on public.project_milestones for all to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
      )
  )
);

drop policy if exists project_updates_access on public.project_updates;
create policy project_updates_access on public.project_updates for all to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        author_id = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
)
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists research_sources_access on public.research_sources;
create policy research_sources_access on public.research_sources for all to authenticated
using (
  exists (
    select 1
    from public.research_workspaces w
    where w.id = workspace_id
      and w.institution_id = private.current_institution_id()
      and (
        w.owner_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) in ('faculty', 'admin')
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

drop policy if exists project_documents_authorized_read on storage.objects;
create policy project_documents_authorized_read on storage.objects for select to authenticated
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
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or (select role from public.profiles where id = (select auth.uid())) = 'admin'
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id and m.student_id = (select auth.uid())
        )
      )
  )
);
