create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.course_documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(content) between 1 and 20000),
  page_number integer check (page_number is null or page_number > 0),
  embedding_model text not null,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_owner_document_idx
  on public.document_chunks(owner_id, document_id);
create index if not exists document_chunks_course_idx
  on public.document_chunks(course_id);
create index if not exists document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.document_chunks enable row level security;
grant select, insert, delete on public.document_chunks to authenticated;

create policy document_chunks_owner_read on public.document_chunks for select to authenticated
using (
  owner_id = (select auth.uid())
  and public.current_app_role() = 'student'
  and exists (
    select 1
    from public.course_documents d
    where d.id = document_id
      and d.owner_id = (select auth.uid())
      and d.course_id = document_chunks.course_id
      and public.can_access_course(d.course_id)
  )
);

create policy document_chunks_owner_insert on public.document_chunks for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.current_app_role() = 'student'
  and exists (
    select 1
    from public.course_documents d
    where d.id = document_id
      and d.owner_id = (select auth.uid())
      and d.course_id = document_chunks.course_id
      and public.can_access_course(d.course_id)
  )
);

create policy document_chunks_owner_delete on public.document_chunks for delete to authenticated
using (
  owner_id = (select auth.uid())
  and public.current_app_role() = 'student'
  and exists (
    select 1
    from public.course_documents d
    where d.id = document_id
      and d.owner_id = (select auth.uid())
      and d.course_id = document_chunks.course_id
      and public.can_access_course(d.course_id)
  )
);

create or replace function public.search_document_chunks(
  p_query_embedding extensions.vector(384),
  p_limit integer default 5,
  p_min_similarity real default 0.25,
  p_embedding_model text default 'sentence-transformers/all-MiniLM-L6-v2'
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  content text,
  similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.title,
    c.page_number,
    c.content,
    (1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding))::real
  from public.document_chunks c
  join public.course_documents d on d.id = c.document_id
  where c.owner_id = (select auth.uid())
    and c.embedding_model = p_embedding_model
    and d.status = 'ready'
    and public.current_app_role() = 'student'
    and public.can_access_course(c.course_id)
    and 1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding OPERATOR(extensions.<=>) p_query_embedding
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke all on function public.search_document_chunks(extensions.vector, integer, real, text) from public, anon;
grant execute on function public.search_document_chunks(extensions.vector, integer, real, text) to authenticated;

create or replace function public.replace_document_chunks(
  p_document_id uuid,
  p_chunks jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_chunk_count integer;
begin
  if coalesce(jsonb_typeof(p_chunks), '') <> 'array'
    or jsonb_array_length(p_chunks) < 1
    or jsonb_array_length(p_chunks) > 2000 then
    raise exception 'Invalid document chunk batch'
      using errcode = '22023';
  end if;

  select d.course_id
  into v_course_id
  from public.course_documents d
  where d.id = p_document_id
    and d.owner_id = (select auth.uid())
    and public.current_app_role() = 'student'
    and public.can_access_course(d.course_id);

  if not found then
    raise exception 'Document is not accessible'
      using errcode = '42501';
  end if;

  delete from public.document_chunks c
  where c.document_id = p_document_id
    and c.owner_id = (select auth.uid());

  insert into public.document_chunks (
    document_id,
    owner_id,
    course_id,
    chunk_index,
    content,
    page_number,
    embedding_model,
    embedding
  )
  select
    p_document_id,
    (select auth.uid()),
    v_course_id,
    chunk.chunk_index,
    chunk.content,
    chunk.page_number,
    chunk.embedding_model,
    chunk.embedding::extensions.vector(384)
  from jsonb_to_recordset(p_chunks) as chunk(
    chunk_index integer,
    content text,
    page_number integer,
    embedding_model text,
    embedding text
  );

  get diagnostics v_chunk_count = row_count;
  return v_chunk_count;
end;
$$;

revoke all on function public.replace_document_chunks(uuid, jsonb) from public, anon;
grant execute on function public.replace_document_chunks(uuid, jsonb) to authenticated;
