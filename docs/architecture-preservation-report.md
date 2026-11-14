# Architecture Preservation Report

Date: 2026-11-08

## Scope

This report records the existing architecture before further feature work. It preserves
Supabase, the Express backend, the React frontend, the existing AI coordinator, and the
six-layer model. No provider, database, authentication system, or architectural layer was
replaced.

## Existing technology audit

| Area | Existing implementation | Preservation requirement |
|---|---|---|
| Frontend | React + TypeScript under `src/` | Extend existing components and `api` client |
| Backend | Node.js + Express in `server.js` and `server/` | Add routes through the existing middleware and repository |
| Authentication | Supabase Auth in `src/services/supabase.ts`; token verification in `server/supabase.js` | Keep Supabase access tokens and trusted profile-derived roles |
| Database | Supabase PostgreSQL migrations under `supabase/migrations/` | Extend tables and policies with additive migrations only |
| Storage | Private Supabase buckets and `storage.objects` policies | Use signed/authenticated access; never expose service credentials |
| AI integration | Express proxy to the existing FastAPI service; coordinator in `ai_service/app/coordinator.py` | Extend the coordinator and existing agents, not a parallel agent system |

## Authentication and authorization findings

- The browser uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The Express server uses `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the
  server-only `SUPABASE_SECRET_KEY` or compatibility alias
  `SUPABASE_SERVICE_ROLE_KEY`.
- `authenticateSupabaseToken()` verifies the bearer token with Supabase Auth, then
  derives the application role from `public.profiles`. Frontend role selection is not
  trusted for authorization.
- Database roles are `student`, `faculty`, and `admin`; the frontend presents the
  faculty role as `instructor` for compatibility.
- Express protects requests with `requireAuth`, `requireRole`, and the existing
  user-scoped Supabase client. The AI service independently verifies the token and
  profile role.
- The recent profile repair is intentionally additive. The API checks the trusted
  service-role profile before creating a missing student profile so an RLS-hidden
  admin profile cannot be downgraded.

## Database and RLS findings

The canonical migration defines and relates:

- `profiles` linked to `auth.users`
- `departments`, `branches`, `regulations`, `academic_years`, `semesters`, and `subjects`
- `courses` linked to `profiles`, subjects, and academic context
- `enrollments` linked to students and courses
- materials, documents, assessments, submissions, progress, activity, recommendations,
  learning paths, planner records, conversations, and messages

The schema uses foreign keys, indexes, checks, private helper functions, and RLS
policies such as `private.has_course_access()` and `private.can_manage_course()`.
Course, profile, document, assessment, progress, and storage access is policy-controlled.
New work must add policies and grants with every new table or sensitive column.

The deployed database has previously differed from the canonical profile migration
(notably the reduced `id,email,role,is_approved` profile shape). Code that reads profiles
must therefore select only columns guaranteed by the deployed schema or be introduced
with a safe migration and a compatibility path.

## Supabase Storage findings

The schema provisions private buckets for:

- `course-materials`
- `student-documents`
- `student-submissions`

The existing policies restrict uploads and reads by authenticated ownership, course
access, publication state, and faculty course management. File type and 10 MB limits
are enforced in the bucket definition and application upload path. New document features
must retain private buckets, validated MIME types, bounded sizes, and authorized or
signed downloads.

## Locked six-layer architecture

The six layers already represented by the application are:

1. **Input Processing** — query and request parsing.
2. **Student Context** — authenticated profile, course, enrollment, and progress context.
3. **Pedagogical Planning** — learning strategy, recommendations, and task planning.
4. **Document Retrieval** — document extraction, chunking, embeddings, and source retrieval.
5. **Formative Assessment** — practice and faculty assessment generation workflows.
6. **Response Validation** — grounding, source-reference validation, and response safety checks.

These names are represented in `SettingsModal.tsx`. Existing mock telemetry also uses
the equivalent names **Perception & Ingestion**, **Memory & Context Framing**,
**Planning & Pedagogical Strategy**, **Execution & RAG Grounding**,
**Formative Assessment Generator**, and **Meta-Cognitive Self-Correction**. Runtime
agent metadata currently reports specialist-agent names rather than either six-layer
label set. This is an existing naming inconsistency, not a reason to add or change a
layer. Future work must preserve the six positions and responsibilities; any
presentation-label reconciliation requires explicit approval.

## Source mapping

| Layer | Responsibility | Existing source components | Future faculty/admin/student features |
|---|---|---|---|
| 1. Input Processing | Validate and normalize user/API input | `src/services/api.ts`, React forms, `server.js`, FastAPI request schemas | Course forms, filters, upload validation, assessment authoring |
| 2. Student Context | Resolve trusted identity and authorized academic context | `server/supabase.js`, `server/supabase-repository.js`, `server/academic-repository.js`, `ai_service/app/auth.py`, `ai_service/app/learning_repository.py` | Institution, department, faculty assignment, enrollment, roster context |
| 3. Pedagogical Planning | Select learning actions and organize course support | `ai_service/app/coordinator.py`, `ai_service/app/agents/learning.py`, planner and learning-path components | Faculty intervention plans, course outcomes, recommendations |
| 4. Document Retrieval | Store, process, retrieve, and cite academic documents | `ai_service/app/rag.py`, `supabase` document tables/RPCs, Storage policies, `StudyMaterials.tsx` | Syllabus, notes, OBLS, tutorials, examination and project documents |
| 5. Formative Assessment | Generate, review, publish, and evaluate practice assessments | `InstructorWorkspace.tsx`, `server/api.js`, `publish_assessment` and `submit_assessment` RPCs, assessment components | Faculty draft review, assignments, quizzes, feedback workflows |
| 6. Response Validation | Enforce permissions and validate AI/data output | Express role checks, RLS policies, `ai_service/app/agents/tutor.py`, proxy validation, source citation checks | Audit logs, publication checks, safe exports, verified analytics |

## Dependency direction

`Input Processing` -> `Student Context` -> `Pedagogical Planning` ->
`Document Retrieval` / `Formative Assessment` -> `Response Validation`.

Authentication and RLS remain cross-cutting controls, not a new layer. The Express
backend remains the single application API boundary, and the FastAPI service remains
the existing AI boundary behind the Express proxy.

## Safe implementation rules for future work

1. Use additive Supabase migrations; never drop or recreate production tables.
2. Add foreign keys, unique constraints, indexes, grants, and RLS policies together.
3. Derive role, user ID, institution, and course ownership from the verified token and
   trusted database records.
4. Keep service-role keys server-only.
5. Route new AI behavior through `Coordinator` and the existing specialist services.
6. Map every new feature to one or more of the six layers above before implementation.
7. Preserve compatibility with the deployed profile schema or migrate it safely first.
8. Add targeted authorization and RLS tests for every new sensitive route or table.

## Architecture diagram

```text
React UI
  -> src/services/api.ts + Supabase browser client
  -> Express API (server.js)
       -> Supabase user-scoped repository and RLS
       -> authenticated AI proxy
            -> FastAPI coordinator
                 -> tutor / learning agents
                 -> Supabase-aware learning and RAG repositories
  -> Supabase Auth + PostgreSQL + private Storage
```

The six layers are logical responsibilities spanning this flow; they are not additional
servers or database access layers.

## Phase 0 repository inventory

### Frontend

- Entry and composition: `src/main.tsx`, `src/App.tsx`, `src/context/AuthContext.tsx`.
- Shared navigation and shell: `src/components/layout/`.
- Student surfaces: dashboard, courses, assessments, tutor, materials, analytics,
  learning path, planner, and coding lab.
- Faculty surface: `src/components/instructor/InstructorWorkspace.tsx`.
- Admin surface: `src/components/admin/AdminWorkspace.tsx`.
- Shared API and auth: `src/services/api.ts`, `src/services/supabase.ts`.
- Tests exist for authentication, role-aware loading, dashboards, navigation, planner,
  learning path, registration, and academic repositories.

### Express API

Implemented route groups include health, auth/provisioning, current user and courses,
student progress/recommendations/learning path/tasks/planner/chat, assessments,
documents, faculty assessment generation, faculty course roster, admin course creation
and allocation, and coding-lab placeholders.

Important current limitations:

- `GET /api/v1/faculty/courses/:courseId/roster` is currently an empty response in
  `server.js`; the authenticated repository path in `server/api.js` is the useful
  implementation.
- Chat message creation intentionally returns `503` because generation is delegated
  to the authenticated AI endpoint.
- Planner optimization and coding-lab execution are explicit unavailable/stub paths.
- Admin routes currently cover course creation and faculty allocation, not the complete
  institution administration scope.

### AI service

- FastAPI entrypoint and HTTP boundary: `ai_service/app/main.py`.
- Token/profile authorization: `ai_service/app/auth.py`.
- Existing coordinator: `ai_service/app/coordinator.py`.
- Tutor provider integration: `ai_service/app/agents/tutor.py` and
  `ai_service/app/providers/`.
- Learning specialists and repository: `ai_service/app/agents/learning.py` and
  `ai_service/app/learning_repository.py`.
- Permission-aware document extraction, chunking, processing, and retrieval:
  `ai_service/app/rag.py`.
- Supabase connectivity and embedding configuration:
  `ai_service/app/supabase_client.py` and `ai_service/app/embeddings.py`.

The service currently supports tutoring, learning workflows, assessment generation,
analytics/recommendation workflows, and RAG primitives. Unsupported intents are
returned explicitly rather than represented as successful fake results.

## Existing feature inventory versus requested scope

| Requested area | Current evidence | Phase 0 status |
|---|---|---|
| Auth and three roles | Supabase Auth, trusted profiles, student/faculty/admin routing | Present; institution-scoped permissions need expansion |
| Student courses and learning | Courses, assessments, tutor, progress, recommendations, planner | Partially present |
| Faculty allocation | Admin course creation and `courses.instructor_id` allocation | Present for the current course model |
| Faculty resources | Private Storage, documents, faculty upload and delete paths | Partially present; broader categories and processing UX remain |
| Assignments and official marks | Assessment schema and official marks tables exist | Partially present; full assignment/evaluation workflow is missing |
| Examinations | Examination papers and answer-key schema/storage policies exist | Read/download foundations present; management UI is missing |
| OBLS/course outcomes/units | No separate complete UI/API workflow identified in current inventory | Missing or incomplete |
| Announcements/notifications/requests | Existing inbox shell, but no complete corresponding domain workflow identified | Missing or incomplete |
| Projects/research | No complete project/research domain workflow identified | Missing |
| Institution administration | Admin workspace currently focuses on courses and allocations | Missing beyond current scope |
| Audit logs | No complete audit-log table/API/UI identified | Missing |
| Permission-aware RAG | Private documents, extraction, chunks, embeddings, retrieval, source validation | Foundation present; live embedding/provider configuration is environment-dependent |

No official marks, attendance, or institutional analytics may be invented to fill these
gaps.

## Supabase configuration assessment

The checked-in examples preserve separate browser publishable and server secret
variables. A local `.env` file is present but its values were not copied into this
report. The production project and migration application state cannot be confirmed from
source inspection alone. Before Phase 1, an authorized operator should verify:

1. `202611080001_repair_auth_profile_trigger.sql` is applied.
2. `202611080002_restore_profile_self_read.sql` is applied.
3. `202611080003_institution_onboarding.sql` is applied before using institution
   onboarding endpoints.
4. The deployed `profiles` columns match the compatibility assumptions.
5. `courses.instructor_id` contains the live faculty allocation.
6. Storage buckets and policies exist in the target project.
7. RLS is enabled on all academic and document tables.

## Security findings and risks

### Controls already present

- Supabase bearer-token verification on Express and the AI service.
- Role checks at API boundaries.
- User-scoped Supabase access for normal operations.
- Server-only service-role and AI-provider credentials.
- Private Storage buckets and MIME/size limits.
- RLS policies for course access, profile access, documents, assessments, progress,
  and storage objects.
- Rate limiting and explicit dependency errors.

### Risks or follow-up findings

- Admin scope is role-based but not yet institution/permission scoped; adding admin
  features without an institution relationship would over-authorize administrators.
- The deployed reduced profile schema and canonical migration differ; new profile
  columns must not be assumed.
- Some route surfaces are placeholders or split between `server.js` and `server/api.js`;
  new work must avoid creating a third routing path and should consolidate only with
  tests.
- Runtime layer telemetry does not carry stable six-layer names.
- Live migration, RLS, Storage, and signed-download behavior require project-level
  verification, not only local tests.
- Institution onboarding is intentionally empty: no institution, profile, department,
  or course is assigned by the migration. An administrator must create an institution
  and explicitly assign users through the protected onboarding workflow.

## Potential files and migration work

Likely existing files for the next approved phases:

- Frontend: `src/App.tsx`, `src/components/layout/Sidebar.tsx`,
  `src/components/admin/AdminWorkspace.tsx`,
  `src/components/instructor/InstructorWorkspace.tsx`,
  `src/components/courses/CourseDetail.tsx`, `src/services/api.ts`.
- Backend: `server.js`, `server/api.js`, `server/supabase.js`,
  `server/supabase-repository.js`, `server/academic-repository.js`.
- AI: `ai_service/app/coordinator.py`, `main.py`, `auth.py`, `rag.py`,
  `learning_repository.py`, and existing agent modules.
- Database: additive migrations under `supabase/migrations/`, reusing existing tables
  before proposing new entities.

Potential migrations, only after live-schema verification, are institution/permission
relationships, course outcomes/units/schedules, assignments/submissions/evaluation,
announcements/notifications/requests, projects/research, and audit events. Each must
include constraints, indexes, grants, RLS, and authorization tests.

The institution onboarding foundation is represented by
`supabase/migrations/202611080003_institution_onboarding.sql`. It adds nullable
institution relationships to profiles, departments, and courses; creates
`institutions` and `institution_admins`; prevents self-assignment through profile RLS;
and requires institution matching for newly institution-scoped course access. Existing
rows remain unassigned and are not rewritten.

The academic foundation is represented by
`supabase/migrations/202611080004_academic_foundation.sql`. It adds course outcomes,
course units, lecture schedules, announcements, assignments, assignment submissions,
and audit logs with foreign keys, constraints, indexes, grants, and RLS. It contains no
seed records.

## Current implementation status after approved continuation

Implemented locally:

- Explicit institution creation, setup inspection, unassigned-user listing, user and
  department assignment, institution-scoped administrator overview, and institution-
  scoped course allocation.
- Course academic foundation retrieval for outcomes, units, schedules, announcements,
  and assignments.
- Faculty publication of announcements and assignments.
- Student authorized announcement reads and assignment submission.
- Faculty/admin authorized submission reads and grading.
- Student course academic workspace UI and faculty course-resource controls.
- Notification drawer backed by authorized published announcements.
- Existing AI coordinator intent classification for academic support, assignment
  support, examination preparation, project/research support, and performance support.

The implementation does not fabricate institution, student, faculty, enrollment, mark,
attendance, project, or research records. Existing users and departments remain
unassigned until an authorized administrator performs onboarding.

## Recommended development sequence after approval

1. Verify the two profile repair migrations and live RLS/Storage state.
2. Close identity and institution-scope gaps without changing the authentication
   provider or six-layer structure.
3. Extend the existing academic foundation: outcomes, units, schedules, and safe
   faculty/student relationships.
4. Implement one complete resource or assignment workflow end to end, including RLS,
   Storage, API authorization, UI states, and tests.
5. Add faculty/admin workflows incrementally, reusing existing workspaces.
6. Extend the coordinator for approved AI capabilities and permission-aware RAG.
7. Add productivity, announcements, projects, and analytics only where verified data
   sources exist.
8. Run frontend, backend, RLS, Storage, AI, and build regression suites after each
   phase.

Per the master prompt, implementation must stop here pending explicit approval for
Phase 1.
