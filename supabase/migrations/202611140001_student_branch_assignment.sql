alter table public.profiles
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists profiles_department_idx on public.profiles(department_id);
create index if not exists profiles_branch_idx on public.profiles(branch_id);
