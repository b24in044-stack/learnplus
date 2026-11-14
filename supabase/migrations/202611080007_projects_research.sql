-- Additive project and research workflows. No records or seed data are created.

create table if not exists public.project_categories (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (institution_id, name)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  course_id uuid references public.courses(id) on delete set null,
  category_id uuid references public.project_categories(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  abstract text not null default '' check (length(abstract) <= 10000),
  description text not null default '' check (length(description) <= 30000),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'in_review', 'revision_requested', 'approved', 'rejected', 'completed')),
  guide_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (project_id, student_id)
);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'approved', 'revision_requested')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (length(btrim(content)) between 1 and 20000),
  created_at timestamptz not null default now()
);

create table if not exists public.project_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('feedback', 'revision_requested', 'approved', 'rejected')),
  content text not null check (length(btrim(content)) between 1 and 20000),
  created_at timestamptz not null default now()
);

create table if not exists public.research_workspaces (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  topic text not null default '' check (length(topic) <= 500),
  problem_statement text not null default '' check (length(problem_statement) <= 10000),
  proposal text not null default '' check (length(proposal) <= 30000),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.research_workspaces(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  authors text not null default '' check (length(authors) <= 2000),
  url text not null check (length(url) <= 2000),
  doi text check (doi is null or length(doi) <= 500),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists projects_institution_status_idx on public.projects(institution_id, status);
create index if not exists project_members_student_idx on public.project_members(student_id);
create index if not exists project_milestones_project_due_idx on public.project_milestones(project_id, due_at);
create index if not exists research_workspaces_owner_idx on public.research_workspaces(owner_id, updated_at desc);
create index if not exists research_sources_workspace_idx on public.research_sources(workspace_id);

alter table public.project_categories enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_feedback enable row level security;
alter table public.research_workspaces enable row level security;
alter table public.research_sources enable row level security;

drop policy if exists project_categories_access on public.project_categories;
create policy project_categories_access on public.project_categories for all to authenticated
using (institution_id = (select institution_id from public.profiles where id = (select auth.uid())))
with check (institution_id = (select institution_id from public.profiles where id = (select auth.uid())));

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
    select 1
    from public.projects p
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
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and p.created_by = (select auth.uid())
  )
  and exists (
    select 1
    from public.profiles p
    where p.id = student_id
      and p.role = 'student'
      and p.institution_id = private.current_institution_id()
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
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
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
        or private.is_institution_admin(p.institution_id)
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
        or private.is_institution_admin(p.institution_id)
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
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
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists project_feedback_access on public.project_feedback;
create policy project_feedback_access on public.project_feedback for all to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.institution_id = private.current_institution_id()
      and (
        author_id = (select auth.uid())
        or
        p.created_by = (select auth.uid())
        or exists (
          select 1
          from public.project_members m
          where m.project_id = p.id
            and m.student_id = (select auth.uid())
        )
        or p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
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
        p.guide_id = (select auth.uid())
        or private.is_institution_admin(p.institution_id)
      )
  )
);

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

revoke all on table public.project_categories, public.projects, public.project_members, public.project_milestones, public.project_updates, public.project_feedback, public.research_workspaces, public.research_sources from anon, authenticated;
grant select, insert, update on public.project_categories, public.projects, public.project_members, public.project_milestones, public.project_updates, public.project_feedback, public.research_workspaces, public.research_sources to authenticated;
