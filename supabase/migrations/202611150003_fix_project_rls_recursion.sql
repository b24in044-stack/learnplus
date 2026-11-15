-- Break the projects/project_members RLS cycle without changing access rules.
create or replace function private.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.institution_id = private.current_institution_id()
      and (
        p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or exists (
          select 1
          from public.profiles actor
          where actor.id = (select auth.uid())
            and actor.role = 'admin'
        )
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function private.can_access_project_member(
  target_project_id uuid,
  target_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.institution_id = private.current_institution_id()
      and (
        target_student_id = (select auth.uid())
        or p.created_by = (select auth.uid())
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  );
$$;

create or replace function private.can_add_project_member(
  target_project_id uuid,
  target_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.institution_id = private.current_institution_id()
      and p.created_by = (select auth.uid())
      and exists (
        select 1
        from public.profiles student
        where student.id = target_student_id
          and student.role = 'student'
          and student.institution_id = private.current_institution_id()
      )
  );
$$;

revoke all on function private.can_access_project(uuid) from public, anon;
revoke all on function private.can_access_project_member(uuid, uuid) from public, anon;
revoke all on function private.can_add_project_member(uuid, uuid) from public, anon;
grant execute on function private.can_access_project(uuid) to authenticated;
grant execute on function private.can_access_project_member(uuid, uuid) to authenticated;
grant execute on function private.can_add_project_member(uuid, uuid) to authenticated;

drop policy if exists projects_access on public.projects;
create policy projects_access on public.projects
for all to authenticated
using (private.can_access_project(id))
with check (
  institution_id = private.current_institution_id()
  and created_by = (select auth.uid())
);

drop policy if exists project_members_access on public.project_members;
create policy project_members_access on public.project_members
for all to authenticated
using (private.can_access_project_member(project_id, student_id))
with check (private.can_add_project_member(project_id, student_id));
