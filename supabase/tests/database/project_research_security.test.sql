begin;

select plan(8);

select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'project_members', 'project membership table exists');
select has_table('public', 'project_updates', 'project updates table exists');
select has_table('public', 'project_feedback', 'project feedback table exists');
select has_table('public', 'research_workspaces', 'research workspaces table exists');
select has_table('public', 'research_sources', 'research sources table exists');
select col_is_pk('public', 'project_members', 'project_id', 'project membership uses a composite primary key');
select col_not_null('public', 'projects', 'institution_id', 'projects require institution ownership');

select * from finish();
rollback;
