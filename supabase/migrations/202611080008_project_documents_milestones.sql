-- Additive project documents, milestone history, and notification de-duplication.

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  milestone_id uuid references public.project_milestones(id) on delete set null,
  document_type text not null check (document_type in ('progress', 'final_report', 'supporting')),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'text/plain', 'text/markdown')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_bucket text not null default 'project-documents',
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.project_milestone_history (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.project_milestones(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('pending', 'submitted', 'approved', 'revision_requested')),
  description text not null default '' check (length(description) <= 20000),
  created_at timestamptz not null default now()
);

create index if not exists project_documents_project_idx
  on public.project_documents(project_id, created_at desc);
create index if not exists project_milestone_history_milestone_idx
  on public.project_milestone_history(milestone_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-documents', 'project-documents', false, 10485760, array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do nothing;

alter table public.project_documents enable row level security;
alter table public.project_milestone_history enable row level security;

drop policy if exists project_documents_access on public.project_documents;
create policy project_documents_access on public.project_documents for select to authenticated
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

drop policy if exists project_milestone_history_access on public.project_milestone_history;
create policy project_milestone_history_access on public.project_milestone_history for select to authenticated
using (
  exists (
    select 1 from public.project_milestones m
    join public.projects p on p.id = m.project_id
    where m.id = milestone_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.student_id = (select auth.uid())
        )
      )
  )
);

revoke all on table public.project_documents, public.project_milestone_history from anon, authenticated;
grant select on public.project_documents to authenticated;
grant select on public.project_milestone_history to authenticated;

drop policy if exists project_documents_owner_upload on storage.objects;
drop policy if exists project_documents_authorized_read on storage.objects;
drop policy if exists project_documents_owner_delete on storage.objects;
create policy project_documents_owner_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-documents'
  and (storage.foldername(name))[1] = 'projects'
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and exists (
    select 1 from public.projects p
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
create policy project_documents_authorized_read on storage.objects for select to authenticated
using (
  bucket_id = 'project-documents'
  and exists (
    select 1 from public.project_documents d
    join public.projects p on p.id = d.project_id
    where d.storage_bucket = bucket_id
      and d.storage_path = name
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
create policy project_documents_owner_delete on storage.objects for delete to authenticated
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

create unique index if not exists notifications_event_dedupe_idx
  on public.notifications(recipient_id, type, entity_type, entity_id)
  where entity_id is not null;

drop policy if exists projects_access on public.projects;
create policy projects_access on public.projects for all to authenticated
using (
  institution_id = (select institution_id from public.profiles where id = (select auth.uid()))
  and (
    created_by = (select auth.uid())
    or guide_id = (select auth.uid())
    or exists (select 1 from public.project_members m where m.project_id = id and m.student_id = (select auth.uid()))
    or (select role from public.profiles where id = (select auth.uid())) = 'admin'
  )
)
with check (
  institution_id = (select institution_id from public.profiles where id = (select auth.uid()))
  and created_by = (select auth.uid())
);

drop policy if exists project_members_access on public.project_members;
create policy project_members_access on public.project_members for all to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        student_id = (select auth.uid())
        or p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and p.created_by = (select auth.uid())
  )
  and exists (
    select 1 from public.profiles p
    where p.id = student_id
      and p.role = 'student'
      and p.institution_id = (select institution_id from public.profiles where id = (select auth.uid()))
  )
);

drop policy if exists project_feedback_access on public.project_feedback;
create policy project_feedback_access on public.project_feedback for all to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.institution_id = (select institution_id from public.profiles where id = (select auth.uid()))
      and (
        author_id = (select auth.uid())
        or
        p.created_by = (select auth.uid())
        or exists (select 1 from public.project_members m where m.project_id = p.id and m.student_id = (select auth.uid()))
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
)
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.institution_id = (select institution_id from public.profiles where id = (select auth.uid()))
      and (p.guide_id = (select auth.uid()) or private.is_institution_admin(p.institution_id))
  )
);

drop policy if exists research_workspace_access on public.research_workspaces;
create policy research_workspace_access on public.research_workspaces for all to authenticated
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
  institution_id = private.current_institution_id()
  and owner_id = (select auth.uid())
);

drop policy if exists attendance_sessions_select_authorized on public.attendance_sessions;
create policy attendance_sessions_select_authorized on public.attendance_sessions
  for select to authenticated
  using (
    private.has_course_access(course_id)
    or private.can_manage_academic_course(course_id)
    or exists (
      select 1 from public.courses c
      join public.profiles p on p.institution_id = c.institution_id
      where c.id = course_id and p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

drop policy if exists attendance_records_select_authorized on public.attendance_records;
create policy attendance_records_select_authorized on public.attendance_records
  for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.attendance_sessions s
      where s.id = session_id
        and (
          private.can_manage_academic_course(s.course_id)
          or exists (
            select 1 from public.courses c
            join public.profiles p on p.institution_id = c.institution_id
            where c.id = s.course_id and p.id = (select auth.uid()) and p.role = 'admin'
          )
        )
    )
  );
