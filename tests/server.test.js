import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  gradeAssessmentQuestions,
  handleApiRequest,
  publicAssessmentQuestion,
  publicAssessmentQuestionResult,
  getFacultyRosterProfile,
  validateCourseMaterialCategory,
  validateCourseMaterialFile,
  createCourseMaterialObjectPath,
} from '../server/api.js';
import { authenticateSupabaseToken, runWithSupabaseRequestClient } from '../server/supabase.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('course material validation enforces stable categories and the existing file formats', () => {
  for (const category of ['syllabus', 'pyq', 'ppt', 'course_pdf', 'other']) {
    assert.equal(validateCourseMaterialCategory(category), category);
  }
  assert.throws(() => validateCourseMaterialCategory(''), /valid course material category/);
  assert.throws(() => validateCourseMaterialCategory('archive'), /valid course material category/);

  assert.equal(validateCourseMaterialFile({
    originalname: 'notes.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 content'),
  }).fileType, 'pdf');
  assert.equal(validateCourseMaterialFile({
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('Course notes'),
  }).fileType, 'text');
  assert.equal(validateCourseMaterialFile({
    originalname: 'notes.md',
    mimetype: 'text/markdown',
    buffer: Buffer.from('# Course notes'),
  }).fileType, 'markdown');
  assert.throws(() => validateCourseMaterialFile({
    originalname: 'notes.pptx',
    mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('presentation'),
  }), /Allowed files are valid PDF, TXT, or Markdown/);
  assert.throws(() => validateCourseMaterialFile({
    originalname: 'fake.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('not a PDF'),
  }), /Allowed files are valid PDF, TXT, or Markdown/);
  assert.throws(() => validateCourseMaterialFile({
    originalname: 'invalid.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from([0xc3, 0x28]),
  }), /Allowed files are valid PDF, TXT, or Markdown/);
  const oversizedPdf = Buffer.alloc(10 * 1024 * 1024 + 1);
  oversizedPdf.write('%PDF-');
  assert.throws(() => validateCourseMaterialFile({
    originalname: 'notes.pdf',
    mimetype: 'application/pdf',
    buffer: oversizedPdf,
  }), /between 1 byte and 10 MB/);
});

test('duplicate filenames receive distinct course-scoped Storage object paths', () => {
  const courseId = 'c3b4e911-2631-4d3e-83c4-00a8cb933255';
  const userId = 'b6f3704f-2d5a-45b0-a6d4-0b4e5512b04c';
  const firstPath = createCourseMaterialObjectPath(courseId, userId);
  const secondPath = createCourseMaterialObjectPath(courseId, userId);
  assert.notEqual(firstPath, secondPath);
  assert.match(firstPath, new RegExp(`^courses/${courseId}/materials/${userId}/[0-9a-f-]+/original$`));
  assert.doesNotMatch(firstPath, /notes\.pdf/);
});

test('admin course creation returns the inserted row before writing its audit log', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const route = source.match(/app\.post\('\/api\/v1\/admin\/courses'[\s\S]*?\n\}\)\);/);

  assert.ok(route, 'admin course creation route exists');
  assert.match(route[0], /\.from\('courses'\)\s*\.insert\([\s\S]*?\)\s*\.select\('id'\)\s*\.single\(\)/);
});

test('faculty roster profile lookup is restricted to students in the assigned course institution', async () => {
  const calls = [];
  const profile = {
    id: 'b6f3704f-2d5a-45b0-a6d4-0b4e5512b04c',
    email: 'student@example.test',
    role: 'student',
    institution_id: 'fa8006d0-722a-45bf-91cd-7b77bd21f9e3',
  };
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return {
                maybeSingle: async () => ({ data: profile, error: null }),
              };
            },
          };
        },
      };
    },
  };

  const rosterProfile = await getFacultyRosterProfile(profile.id, profile.institution_id, client);

  assert.equal(rosterProfile.email, profile.email);
  assert.equal(rosterProfile.role, 'student');
  assert.equal(await getFacultyRosterProfile(profile.id, 'different-institution', client), null);
  assert.equal(await getFacultyRosterProfile(profile.id, '', client), null);
  assert.deepEqual(calls.slice(0, 3), [
    ['from', 'profiles'],
    ['select', 'id,email,role,institution_id'],
    ['eq', 'id', profile.id],
  ]);
});

test('chat session creation relies on the database-generated ID', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  const route = source.match(/if \(method === 'POST' && path === '\/chat\/sessions'\) \{[\s\S]*?\n    \}/);

  assert.ok(route, 'chat session creation route exists');
  assert.match(route[0], /const conversation = await createRecord\(/);
  assert.doesNotMatch(route[0], /createRecord\([\s\S]*?,\s*id\s*\)/);
  assert.match(route[0], /id:\s*conversation\.id/);
});

test('institution onboarding migration is empty and enforces scoped course access', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080003_institution_onboarding.sql'),
    'utf8',
  );
  assert.match(migration, /create table if not exists public\.institutions/i);
  assert.match(migration, /add column if not exists institution_id uuid/i);
  assert.match(migration, /private\.same_institution\(c\.institution_id\)/i);
  assert.match(migration, /created_by uuid not null references public\.profiles/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.institutions/i);
  assert.match(migration, /institution_id is not distinct from private\.current_institution_id\(\)/i);
  assert.match(migration, /drop policy if exists catalog_authenticated_read on public\.departments/i);
  assert.match(migration, /institution_id is null\s+or institution_id = private\.current_institution_id\(\)/i);
});

test('academic foundation migration is additive and policy protected', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080004_academic_foundation.sql'),
    'utf8',
  );
  for (const table of [
    'course_outcomes',
    'course_units',
    'lecture_schedules',
    'announcements',
    'assignments',
    'assignment_submissions',
    'audit_logs',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.doesNotMatch(migration, /insert\s+into\s+public\./i);
  assert.match(migration, /private\.can_manage_academic_course/i);
  assert.match(migration, /private\.has_course_access/i);
});

test('security correction migration protects grading fields and grants tenant columns', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080005_security_corrections.sql'),
    'utf8',
  );
  assert.match(migration, /grant select \(institution_id\) on public\.profiles to authenticated/i);
  assert.match(migration, /grant select \(institution_id\) on public\.courses to authenticated/i);
  assert.match(migration, /revoke insert, update on public\.assignment_submissions from authenticated/i);
  assert.match(migration, /grant update \(content, attachment_url\)/i);
  assert.match(migration, /grant insert \(assignment_id, student_id, content, attachment_url\)/i);
  assert.match(migration, /student_submissions_owner_upload/i);
  assert.match(migration, /attachment_url ~ \('\^assignments\//i);
  assert.match(migration, /grade is null/i);
  assert.match(migration, /private\.current_app_role\(\) = 'student'/i);
});

test('notifications and attendance migration is additive and owner protected', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080006_notifications_attendance.sql'),
    'utf8',
  );
  for (const table of ['notifications', 'attendance_sessions', 'attendance_records']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /notifications_select_own/i);
  assert.match(migration, /unique \(session_id, student_id\)/i);
  assert.match(migration, /grant update \(read_at\) on public\.notifications/i);
  assert.doesNotMatch(migration, /grant select, update on public\.notifications/i);
  assert.match(migration, /e\.student_id = attendance_records\.student_id/i);
  assert.match(migration, /lower\(e\.status\) in \('active', 'enrolled'\)/i);
  assert.doesNotMatch(migration, /grant select, insert, update, delete on public\.attendance_sessions/i);
  assert.doesNotMatch(migration, /insert\\s+into\\s+public\\.(notifications|attendance_sessions|attendance_records)/i);
});

test('attendance writes enforce the course institution for enrolled students', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611120002_attendance_tenant_integrity.sql'),
    'utf8',
  );
  assert.match(migration, /private\.student_matches_course_institution/i);
  assert.match(migration, /student\.institution_id = course\.institution_id/i);
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  assert.match(source, /profiles!inner\(role,institution_id\)/i);
  assert.match(source, /row\.profiles\.institution_id === course\.institution_id/i);
});

test('projects and research migration is additive and institution isolated', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080007_projects_research.sql'),
    'utf8',
  );
  for (const table of ['projects', 'project_members', 'project_milestones', 'project_updates', 'project_feedback', 'research_workspaces', 'research_sources']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /institution_id uuid not null references public\.institutions/i);
  assert.match(migration, /project_members_student_idx/i);
  assert.match(migration, /project_members_access/i);
  assert.match(migration, /p\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /private\.is_institution_admin\(p\.institution_id\)/i);
  assert.match(migration, /research_workspace_access/i);
  assert.doesNotMatch(migration, /role from public\.profiles[\s\S]*?in \('faculty', 'admin'\)/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\./i);
});

test('attendance and project routes validate ownership-sensitive operations', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  assert.match(source, /Attendance can only be recorded for enrolled students/);
  assert.match(source, /Only the assigned faculty member can edit this session/);
  assert.match(source, /if \(user\.role !== 'instructor'\) throw fail\(403, 'Only faculty can create attendance sessions\.'/);
  assert.match(source, /if \(user\.role !== 'instructor'\) throw fail\(403, 'Only faculty can save attendance\.'/);
  assert.match(source, /Only project students can submit progress updates/);
  assert.match(source, /Only faculty or administrators can review projects/);
  assert.match(source, /data\.institution_id !== user\.institutionId/);
});

test('administrator attendance reports are branch-scoped and attendance writes are faculty-only', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  const branchRoute = source.match(/if \(method === 'GET' && path === '\/attendance\/branches'\)[\s\S]*?\n    \}/);
  const reportRoute = source.match(/if \(method === 'GET' && path === '\/attendance\/report'\)[\s\S]*?\n    \}/);
  const migration = fs.readFileSync(path.join(projectRoot, 'supabase', 'migrations', '202611140002_attendance_faculty_write_only.sql'), 'utf8');

  assert.ok(branchRoute, 'admin branch filter endpoint exists');
  assert.ok(reportRoute, 'admin attendance report endpoint exists');
  assert.match(branchRoute[0], /user\.role !== 'admin'/);
  assert.match(branchRoute[0], /\.eq\('institution_id', user\.institutionId\)/);
  assert.match(reportRoute[0], /user\.role !== 'admin'/);
  assert.match(reportRoute[0], /course\.branch_id === branchId/);
  assert.match(reportRoute[0], /\.eq\('institution_id', user\.institutionId\)/);
  assert.match(migration, /private\.current_app_role\(\) = 'faculty'/);
  assert.match(migration, /private\.can_manage_course\(s\.course_id\)/);
  assert.doesNotMatch(migration, /drop\s+table|delete\s+from|truncate\s+/i);
});

test('project document migration keeps storage private and adds milestone history', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080008_project_documents_milestones.sql'),
    'utf8',
  );
  assert.match(migration, /create table if not exists public\.project_documents/i);
  assert.match(migration, /create table if not exists public\.project_milestone_history/i);
  assert.match(migration, /'project-documents', 'project-documents', false/i);
  assert.match(migration, /project_documents_authorized_read/i);
  assert.match(migration, /create unique index if not exists notifications_event_dedupe_idx/i);
  assert.match(migration, /project_documents_access on public\.project_documents for select/i);
  assert.match(migration, /grant select on public\.project_documents to authenticated/i);
  assert.doesNotMatch(migration, /grant select, insert, update, delete on public\.project_documents/i);
  assert.match(migration, /p\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /private\.is_institution_admin\(p\.institution_id\)/i);
  assert.doesNotMatch(migration, /create policy project_documents_access on public\.project_documents for all/i);
  assert.doesNotMatch(migration, /public\s*=\s*true/i);
});

test('tenant policy correction migration isolates project and research child records', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080009_tenant_policy_corrections.sql'),
    'utf8',
  );
  for (const policy of [
    'project_documents_access',
    'project_milestone_history_access',
    'project_children_access',
    'project_updates_access',
    'research_sources_access',
    'project_documents_authorized_read',
  ]) {
    assert.match(migration, new RegExp(`drop policy if exists ${policy}`, 'i'));
    assert.match(migration, new RegExp(`create policy ${policy}`, 'i'));
  }
  assert.match(migration, /p\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /w\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /public\.project_documents/i);
  assert.match(migration, /revoke update on public\.project_documents from authenticated/i);
});

test('forward authorization migration separates project document deletion and tenant-scopes Storage mutations', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080010_project_research_storage_authorization.sql'),
    'utf8',
  );
  assert.match(migration, /for select to authenticated/i);
  assert.match(migration, /project_documents_insert_authorized/i);
  assert.match(migration, /project_documents_delete_authorized/i);
  assert.match(migration, /p\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /d\.storage_path = name/i);
  assert.match(migration, /drop policy if exists project_documents_owner_upload/i);
  assert.match(migration, /drop policy if exists project_documents_owner_delete/i);
  assert.match(migration, /research_workspace_access/i);
  assert.match(migration, /private\.is_institution_admin/i);
  assert.match(migration, /revoke insert, update, delete on public\.project_documents from authenticated/i);
  assert.match(migration, /grant insert, delete on public\.project_documents to authenticated/i);
  assert.doesNotMatch(migration, /create policy project_documents_access on public\.project_documents\s+for all/i);
});

test('project document follow-up keeps Storage object updates revoked', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080011_project_document_tenant_followup.sql'),
    'utf8',
  );
  assert.match(migration, /revoke update on storage\.objects from authenticated/i);
  assert.doesNotMatch(migration, /grant update on storage\.objects to authenticated/i);
});

test('storage object updates are revoked from public client roles', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611120001_revoke_storage_object_updates.sql'),
    'utf8',
  );
  assert.match(migration, /revoke update on storage\.objects from anon, authenticated/i);
});

test('project document follow-up keeps metadata deletion tenant-scoped', () => {
  const migration = fs.readFileSync(
    path.join(projectRoot, 'supabase', 'migrations', '202611080011_project_document_tenant_followup.sql'),
    'utf8',
  );
  assert.match(migration, /drop policy if exists project_documents_delete_authorized/i);
  assert.match(migration, /uploaded_by = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /p\.institution_id = private\.current_institution_id\(\)/i);
  assert.match(migration, /revoke update on storage\.objects from authenticated/i);
  assert.doesNotMatch(migration, /grant update on storage\.objects to authenticated/i);
});

test('project team routes enforce owner and institution authorization', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  assert.match(source, /Only the project owner can add team members/);
  assert.match(source, /profile\.institution_id !== user\.institutionId/);
  assert.match(source, /Only the project owner can remove team members/);
  assert.match(source, /The project owner cannot be removed/);
});

test('project API includes private document, milestone, and notification workflows', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  assert.match(source, /uploadProjectDocument/);
  assert.match(source, /createSignedUrl/);
  assert.match(source, /project_milestone_history/);
  assert.match(source, /notifyProjectParticipants/);
});

test('notification routes are authenticated and notification writes are server-owned', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  assert.ok(source.includes("app.get('/api/v1/me/notifications', requireAuth"));
  assert.ok(source.includes("app.patch('/api/v1/me/notifications/:notificationId', requireAuth"));
  assert.ok(source.includes("app.post('/api/v1/me/notifications/read-all', requireAuth"));
  const supabaseSource = fs.readFileSync(path.join(projectRoot, 'server', 'supabase.js'), 'utf8');
  assert.match(supabaseSource, /notifyCourseStudents/);
  assert.match(supabaseSource, /\.from\('notifications'\)\.upsert/);
});

test('institution assignment rejects assigning the administrator themselves', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  assert.match(source, /if \(profileId === req\.user\.id\)/);
  assert.match(source, /cannot assign their own profile to an institution/);
});

test('admin setup automatically uses a single institution the admin is authorized to manage', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  assert.match(source, /function resolveAdminInstitutionId\(context, preferredInstitutionId\)/);
  assert.match(source, /if \(context\.institutions\.length === 1\) return context\.institutions\[0\]\.id/);
  assert.match(source, /async function activateSingleAdminInstitution\(user, context\)/);
  assert.match(source, /\.from\('institution_admins'\)\.upsert/);
  assert.match(source, /\.update\(\{ institution_id: institutionId \}\)/);
  assert.match(source, /req\.user = await activateSingleAdminInstitution\(req\.user, institutionContext\)/);
  assert.match(source, /action: 'administrator_assigned_to_owned_institution'/);
});

test('student approvals are institution-scoped and create an inbox notification', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const listRoute = source.match(/app\.get\('\/api\/v1\/admin\/institutions\/:institutionId\/students'[\s\S]*?\n\}\)\);/);
  const approveRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/students\/:profileId\/approve'[\s\S]*?\n\}\)\);/);

  assert.ok(listRoute, 'pending student list route exists');
  assert.ok(approveRoute, 'student approval route exists');
  assert.match(listRoute[0], /requireRole\('admin'\)/);
  assert.match(listRoute[0], /requireInstitutionSetupAccess\(context, institutionId\)/);
  assert.match(listRoute[0], /\.eq\('institution_id', institutionId\)[\s\S]*?\.eq\('role', 'student'\)/);
  assert.match(listRoute[0], /isApproved: typeof isApproved === 'boolean' \? isApproved : null/);
  assert.match(approveRoute[0], /target\.role !== 'student'/);
  assert.match(approveRoute[0], /target\.institution_id !== institutionId/);
  assert.match(approveRoute[0], /\.update\(\{ is_approved: true \}\)/);
  assert.match(approveRoute[0], /\.from\('notifications'\)\.insert/);
  assert.match(approveRoute[0], /Your student account has been approved/);
});

test('admin-defined departments, branches, courses, and student class assignment are institution-scoped', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const enrollmentSource = fs.readFileSync(path.join(projectRoot, 'server', 'branch-enrollment.js'), 'utf8');
  const departmentRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/departments'[\s\S]*?\n\}\)\);/);
  const branchRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/departments\/:departmentId\/branches'[\s\S]*?\n\}\)\);/);
  const studentBranchRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/students\/:profileId\/branch'[\s\S]*?\n\}\)\);/);
  const batchStudentBranchRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/students\/branch'[\s\S]*?\n\}\)\);/);
  const courseStudentAssignmentRoute = source.match(/app\.post\('\/api\/v1\/admin\/institutions\/:institutionId\/courses\/:courseId\/students'[\s\S]*?\n\}\)\);/);
  const courseRoute = source.match(/app\.post\('\/api\/v1\/admin\/courses'[\s\S]*?\n\}\)\);/);

  assert.ok(departmentRoute, 'department creation route exists');
  assert.ok(branchRoute, 'branch creation route exists');
  assert.ok(studentBranchRoute, 'student branch assignment route exists');
  assert.ok(batchStudentBranchRoute, 'batch student branch assignment route exists');
  assert.ok(courseStudentAssignmentRoute, 'direct course student assignment route exists');
  assert.ok(courseRoute, 'course creation route exists');
  for (const route of [departmentRoute, branchRoute, studentBranchRoute, batchStudentBranchRoute]) {
    assert.match(route[0], /requireRole\('admin'\)/);
    assert.match(route[0], /requireInstitutionSetupAccess\(context, institutionId\)/);
  }
  assert.match(departmentRoute[0], /\.eq\('institution_id', institutionId\)/);
  assert.match(branchRoute[0], /\.eq\('institution_id', institutionId\)/);
  assert.match(studentBranchRoute[0], /student\.role !== 'student'/);
  assert.match(studentBranchRoute[0], /student\.institution_id !== institutionId/);
  assert.match(studentBranchRoute[0], /branch_id: branchId/);
  assert.match(studentBranchRoute[0], /department_id: department\.id/);
  assert.match(studentBranchRoute[0], /\.select\('id,branch_id'\)/);
  assert.doesNotMatch(studentBranchRoute[0], /current_semester_id/);
  assert.match(batchStudentBranchRoute[0], /profileIds\.length > 1000/);
  assert.match(batchStudentBranchRoute[0], /new Set\(profileIds\)\.size !== profileIds\.length/);
  assert.match(batchStudentBranchRoute[0], /\.in\('id', profileIds\)[\s\S]*?\.eq\('institution_id', institutionId\)[\s\S]*?\.eq\('role', 'student'\)/);
  assert.match(batchStudentBranchRoute[0], /students\.length !== profileIds\.length/);
  assert.match(batchStudentBranchRoute[0], /department\.institution_id !== institutionId/);
  assert.match(batchStudentBranchRoute[0], /assignedCount: data\.length/);
  assert.match(studentBranchRoute[0], /prepareBranchCourseEnrollments/);
  assert.match(studentBranchRoute[0], /saveBranchCourseEnrollments/);
  assert.match(batchStudentBranchRoute[0], /prepareBranchCourseEnrollments/);
  assert.match(batchStudentBranchRoute[0], /saveBranchCourseEnrollments/);
  assert.match(courseStudentAssignmentRoute[0], /requireRole\('admin'\)/);
  assert.match(courseStudentAssignmentRoute[0], /requireInstitutionSetupAccess\(context, institutionId\)/);
  assert.match(courseStudentAssignmentRoute[0], /\.eq\('institution_id', institutionId\)/);
  assert.match(courseStudentAssignmentRoute[0], /\.eq\('role', 'student'\)/);
  assert.match(courseStudentAssignmentRoute[0], /profileIds\.length > 1000/);
  assert.match(courseStudentAssignmentRoute[0], /prepareCourseStudentEnrollments/);
  assert.match(courseStudentAssignmentRoute[0], /alreadyEnrolledCount/);
  assert.match(courseRoute[0], /facultyId, branchId/);
  assert.match(courseRoute[0], /\.eq\('institution_id', institutionId\)/);
  assert.match(courseRoute[0], /department_id: department\.id/);
  assert.match(courseRoute[0], /branch_id: branch\.id/);
  assert.match(courseRoute[0], /enrolledStudentCount/);
  assert.match(courseRoute[0], /prepareBranchCourseEnrollments/);
  assert.match(courseRoute[0], /saveBranchCourseEnrollments/);
  assert.match(enrollmentSource, /MAX_BRANCH_ENROLLMENTS_PER_ASSIGNMENT/);
  assert.match(enrollmentSource, /existing\.has\(`\$\{studentId\}:\$\{course\.id\}`\)/);
  assert.match(enrollmentSource, /status: 'active'/);

  const migration = fs.readFileSync(path.join(projectRoot, 'supabase', 'migrations', '202611140001_student_branch_assignment.sql'), 'utf8');
  assert.match(migration, /add column if not exists department_id uuid references public\.departments\(id\) on delete set null/);
  assert.match(migration, /add column if not exists branch_id uuid references public\.branches\(id\) on delete set null/);
  assert.match(migration, /create index if not exists profiles_department_idx/);
  assert.match(migration, /create index if not exists profiles_branch_idx/);
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|column)|delete\s+from|truncate\s+/i);
});

test('assignment attachments require a private owner-scoped submission path', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'server', 'api.js'), 'utf8');
  assert.match(source, /Attachment must be an authorized private submission path/);
  assert.match(source, /assignments\/\$\{assignmentId\}\/\$\{user\.id\}/);
});

test('Supabase authentication loads the trusted profile without creating one', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    requests.push({ url, method: init.method || 'GET', body: init.body, headers });
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({
        id: 'student-1',
        email: 'student@example.edu',
        user_metadata: { full_name: 'Student One' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/profiles' && init.method !== 'POST') {
      return new Response(JSON.stringify([{
        id: 'student-1',
        email: 'student@example.edu',
        role: 'student',
        institution_id: null,
        is_approved: true,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Unexpected profile write', { status: 500 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  const authenticated = await authenticateSupabaseToken('unit-test-access-token');

  assert.equal(authenticated.user.id, 'student-1');
  assert.equal(authenticated.user.role, 'student');
  const profileRequest = requests.find((request) => request.url.pathname === '/rest/v1/profiles');
  assert.ok(profileRequest);
  assert.equal(profileRequest.url.searchParams.get('select'), 'id,email,role,institution_id,is_approved');
  assert.equal(authenticated.user.name, 'Student One');
  assert.equal(authenticated.user.institutionId, '');
  assert.equal(profileRequest.headers.get('apikey'), 'test-secret-key');
  assert.equal(
    requests.filter((request) =>
      request.url.pathname === '/rest/v1/profiles' && request.method === 'POST'
    ).length,
    0,
  );
});

test('Supabase authentication reads profile fields through the trusted server client', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    requests.push({ url, method: init.method || 'GET', headers });
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({
        id: 'admin-1',
        email: 'admin@example.edu',
        user_metadata: { full_name: 'Admin User' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/rest/v1/profiles' && init.method !== 'POST') {
      const isTrustedRequest = headers.get('apikey') === 'test-secret-key';
      return new Response(JSON.stringify(isTrustedRequest ? [{
        id: 'admin-1',
        email: 'admin@example.edu',
        role: 'admin',
        institution_id: null,
        is_approved: true,
      }] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Unexpected profile write', { status: 500 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  const authenticated = await authenticateSupabaseToken('unit-test-access-token');

  assert.equal(authenticated.user.role, 'admin');
  assert.equal(authenticated.user.institutionId, '');
  assert.equal(
    requests.filter((request) => request.url.pathname === '/rest/v1/profiles').length,
    1,
  );
  assert.equal(
    requests.filter((request) => request.url.pathname === '/rest/v1/profiles' && request.method === 'POST').length,
    0,
  );
});

test('Supabase authentication rejects an account without a trusted profile', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, method: init.method || 'GET' });
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'missing-profile', email: 'missing@example.edu' }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/profiles') {
      return new Response('[]', { status: 200 });
    }
    return new Response('Unexpected profile write', { status: 500 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  assert.equal(await authenticateSupabaseToken('unit-test-access-token'), null);
  assert.equal(
    requests.filter((request) =>
      request.url.pathname === '/rest/v1/profiles' && request.method === 'POST'
    ).length,
    0,
  );
});

test('Supabase authentication falls back when institution_id is not deployed yet', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  const profileSelects = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({
        id: 'legacy-student',
        email: 'legacy@example.edu',
      }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/profiles') {
      const select = url.searchParams.get('select');
      profileSelects.push(select);
      if (select === 'id,email,role,institution_id,is_approved') {
        return new Response(JSON.stringify({
          code: '42703',
          message: 'column profiles.institution_id does not exist',
        }), { status: 400 });
      }
      if (select === 'id,email,role,is_approved') {
        return new Response(JSON.stringify([{
          id: 'legacy-student',
          email: 'legacy@example.edu',
          role: 'student',
          is_approved: true,
        }]), { status: 200 });
      }
      return new Response(JSON.stringify([{
        id: 'legacy-student',
        email: 'legacy@example.edu',
        role: 'student',
      }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  const authenticated = await authenticateSupabaseToken('unit-test-access-token');

  assert.equal(authenticated.user.id, 'legacy-student');
  assert.equal(authenticated.user.institutionId, '');
  assert.equal(authenticated.user.isApproved, true);
  assert.deepEqual(profileSelects, [
    'id,email,role,institution_id,is_approved',
    'id,email,role,is_approved',
  ]);
});

test('Supabase authentication fails closed when approval status is unavailable', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'legacy-student', email: 'legacy@example.edu' }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/profiles') {
      if (url.searchParams.get('select') !== 'id,email,role') {
        return new Response(JSON.stringify({
          code: '42703',
          message: 'column profiles.is_approved does not exist',
        }), { status: 400 });
      }
      return new Response(JSON.stringify([{
        id: 'legacy-student',
        email: 'legacy@example.edu',
        role: 'student',
      }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  await assert.rejects(
    authenticateSupabaseToken('unit-test-access-token'),
    { status: 503, code: 'approval_status_unavailable' },
  );
});

test('Supabase authentication exposes explicit approval status without changing legacy roles', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalSecretKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      return new Response(JSON.stringify({ id: 'pending-user', email: 'pending@example.edu' }), { status: 200 });
    }
    if (url.pathname === '/rest/v1/profiles') {
      return new Response(JSON.stringify([{
        id: 'pending-user',
        email: 'pending@example.edu',
        role: 'student',
        institution_id: null,
        is_approved: false,
      }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey;
    if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
  });

  const authenticated = await authenticateSupabaseToken('pending-access-token');
  assert.equal(authenticated.user.role, 'student');
  assert.equal(authenticated.user.isApproved, false);
});

test('assessment submissions omit answer keys and grading details', () => {
  const result = publicAssessmentQuestionResult({
    id: 'question-1',
    questionText: 'Question',
    correctOptionIndex: 2,
    explanation: 'Private answer explanation',
  }, 1);

  assert.deepEqual(result, {
    questionId: 'question-1',
    questionText: 'Question',
    selectedOption: 1,
  });
  assert.equal('correctOption' in result, false);
  assert.equal('isCorrect' in result, false);
  assert.equal('explanation' in result, false);
});

test('student assessment questions withhold answer explanations until after submission', () => {
  const question = {
    id: 'question-1',
    questionText: 'Question',
    options: ['wrong', 'correct'],
    correctOptionIndex: 1,
    explanation: 'The second option is correct.',
    topicTag: 'Topic',
  };

  const studentQuestion = publicAssessmentQuestion(question, 'student');
  assert.equal('correctOptionIndex' in studentQuestion, false);
  assert.equal('explanation' in studentQuestion, false);
  assert.equal(publicAssessmentQuestion(question, 'instructor').correctOptionIndex, 1);
  assert.equal(publicAssessmentQuestion(question, 'instructor').explanation, question.explanation);
});

test('official assessment grading counts correct answers without exposing grading details', () => {
  const { correctCount, results } = gradeAssessmentQuestions([
    {
      id: 'q1',
      questionText: 'First question',
      options: ['correct', 'wrong'],
      correctOptionIndex: 0,
      explanation: 'Private explanation',
    },
    {
      id: 'q2',
      questionText: 'Second question',
      options: ['wrong', 'correct'],
      correctOptionIndex: 1,
      explanation: 'Private explanation',
    },
  ], { q1: 0, q2: 0 });

  assert.equal(correctCount, 1);
  assert.equal(Math.round(correctCount / results.length * 100), 50);
  assert.deepEqual(results[0], {
    questionId: 'q1',
    questionText: 'First question',
    selectedOption: 0,
  });
  assert.equal('correctOptionIndex' in results[0], false);
  assert.equal('isCorrect' in results[0], false);
  assert.equal('explanation' in results[0], false);
});

test('official assessment grading rejects out-of-range answers', () => {
  assert.throws(() => gradeAssessmentQuestions([{
    id: 'q1',
    questionText: 'Question',
    options: ['a', 'b'],
    correctOptionIndex: 0,
  }], { q1: 2 }), /selected answers are invalid/);
});

test('authenticated course and assessment routes do not fail on route matching', async () => {
  const client = {
    from() {
      const query = {
        select() { return this; },
        eq() { return this; },
        async range() { return { data: [], error: null }; },
      };
      return query;
    },
  };
  const user = { id: 'student-1', role: 'student' };

  for (const path of ['/me/courses', '/assessments']) {
    let status = 200;
    let body;
    const req = { method: 'GET', path, user, query: {} };
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
    };

    await runWithSupabaseRequestClient(client, () => handleApiRequest(req, res, () => {}));

    assert.equal(status, 200, `${path} should succeed for an authenticated student`);
    assert.deepEqual(body, []);
  }

  let uploadStatus = 200;
  let uploadBody;
  const uploadResponse = {
    status(code) {
      uploadStatus = code;
      return this;
    },
    json(value) {
      uploadBody = value;
      return this;
    },
  };
  await runWithSupabaseRequestClient(client, () => handleApiRequest({
    method: 'POST',
    path: '/courses/course-1/documents',
    user,
    body: {},
  }, uploadResponse, () => {}));

  assert.equal(uploadStatus, 403);
  assert.match(uploadBody.detail, /Only faculty can upload/);

  let materialUploadStatus = 200;
  const materialUploadResponse = {
    status(code) {
      materialUploadStatus = code;
      return this;
    },
    json() {
      return this;
    },
  };
  await runWithSupabaseRequestClient(client, () => handleApiRequest({
    method: 'POST',
    path: '/courses/b6f3704f-2d5a-45b0-a6d4-0b4e5512b04c/materials',
    user,
    body: {},
  }, materialUploadResponse, () => {}));
  assert.equal(materialUploadStatus, 403);
});

test('faculty course listing uses only profile columns available in deployed schemas', async () => {
  const course = {
    id: 'course-1',
    code: 'CS 101',
    title: 'Foundations',
    description: '',
    instructor_id: 'faculty-1',
    subject_id: null,
    department_id: null,
    branch_id: null,
    regulation_id: null,
    academic_year_id: null,
    semester_id: null,
    credits: 0,
    topics: [],
    status: 'active',
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const requestedProfileColumns = [];
  const client = {
    from(table) {
      let idFilter;
      const query = {
        select(columns) {
          if (table === 'profiles') requestedProfileColumns.push(columns);
          return this;
        },
        eq(column, value) {
          if (column === 'id') idFilter = value;
          return this;
        },
        async range() {
          return { data: table === 'courses' ? [course] : [], error: null };
        },
        async maybeSingle() {
          return {
            data: table === 'profiles' && idFilter === 'faculty-1'
              ? { id: 'faculty-1', email: 'faculty@example.edu', role: 'faculty' }
              : null,
            error: null,
          };
        },
      };
      return query;
    },
  };
  const req = {
    method: 'GET',
    path: '/me/courses',
    user: { id: 'faculty-1', role: 'instructor' },
    query: {},
  };
  let status = 200;
  let body;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  await runWithSupabaseRequestClient(client, () => handleApiRequest(req, res, () => {}));

  assert.equal(status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 'course-1');
  assert.deepEqual(requestedProfileColumns, ['id,email,role']);
});

test('refuses to start the demo server in production mode', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEMO_MODE cannot be enabled in production/);
});

test('rejects invalid trusted proxy hop configuration', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, DEMO_MODE: 'false', TRUST_PROXY_HOPS: '-1' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TRUST_PROXY_HOPS must be a non-negative integer/);
});

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(demoMode, extraEnv = {}) {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DEMO_MODE: String(demoMode),
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      FACULTY_INVITE_CODE: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API server exited with code ${child.exitCode}`);
    try {
      await fetch(`${baseUrl}/health`);
      return { child, baseUrl };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  child.kill();
  throw new Error(`API server did not become ready. ${output}`);
}

test('validates faculty invite codes only on the server', async (t) => {
  const server = await startApi(false, { FACULTY_INVITE_CODE: 'test-faculty-invite' });
  t.after(() => stopApi(server.child));

  const validate = (inviteCode) => fetch(`${server.baseUrl}/auth/faculty-invite/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode }),
  });
  const accepted = await validate('test-faculty-invite');
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { valid: true });

  const rejected = await validate('wrong-code');
  assert.equal(rejected.status, 403);
  assert.match((await rejected.json()).detail, /invite code is invalid/i);

  const oversized = await validate('x'.repeat(257));
  assert.equal(oversized.status, 403);
});

async function startVite() {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host=127.0.0.1',
    `--port=${port}`,
    '--strictPort',
  ], {
    cwd: projectRoot,
    env: { ...process.env, DISABLE_HMR: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const url = `http://127.0.0.1:${port}/.env`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited with code ${child.exitCode}`);
    try {
      return { child, response: await fetch(url) };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error(`Vite did not become ready. ${output}`);
}

async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

test('Vite refuses to serve environment secrets', async (t) => {
  const vite = await startVite();
  t.after(() => stopApi(vite.child));

  const body = await vite.response.text();
  assert.equal(vite.response.status, 403);
  assert.doesNotMatch(body, /SUPABASE_SECRET_KEY=|DATABASE_URL=/);
});

async function login(baseUrl, email, role) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, password: role === 'student' ? 'AcademicPass2026!' : 'FacultyPass2026!' }),
  });
  return { response, body: await response.json() };
}

test('server health, demo policy, auth, authorization, and document deletion', async (t) => {
  const productionServer = await startApi(false);
  t.after(() => stopApi(productionServer.child));

  const health = await fetch(`${productionServer.baseUrl}/health`);
  assert.equal(health.status, 503);
  const healthBody = await health.json();
  assert.equal(healthBody.demo_mode, false);
  const corsHealth = await fetch(`${productionServer.baseUrl}/health`, {
    headers: { Origin: 'http://localhost:3000' },
  });

  assert.equal(corsHealth.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  const vitePortCorsHealth = await fetch(`${productionServer.baseUrl}/health`, {
    headers: { Origin: 'http://127.0.0.1:3003' },
  });
  assert.equal(vitePortCorsHealth.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3003');
  const blockedOrigin = await fetch(`${productionServer.baseUrl}/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(blockedOrigin.status, 403);

  assert.equal(healthBody.supabase_configured, false);

  const rejectedLogin = await login(productionServer.baseUrl, 'a.chen@university.edu', 'student');
  assert.equal(rejectedLogin.response.status, 410);
  assert.match(rejectedLogin.body.detail, /Supabase Authentication from the frontend/);

  const unauthorized = await fetch(`${productionServer.baseUrl}/me/courses`);
  assert.equal(unauthorized.status, 401);
  const unauthorizedAcademic = await fetch(`${productionServer.baseUrl}/academic/materials`);
  assert.equal(unauthorizedAcademic.status, 401);
  const unauthorizedAgents = await fetch(`${productionServer.baseUrl}/agents/status`);
  assert.equal(unauthorizedAgents.status, 401);
  const unauthorizedMarks = await fetch(`${productionServer.baseUrl}/me/marks`);
  assert.equal(unauthorizedMarks.status, 401);
  const unauthorizedAdminList = await fetch(`${productionServer.baseUrl}/admin/course-assignments`);
  assert.equal(unauthorizedAdminList.status, 401);
  const unauthorizedAdminCreate = await fetch(`${productionServer.baseUrl}/admin/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'CS 101', title: 'Intro', facultyId: '00000000-0000-4000-8000-000000000001' }),
  });
  assert.equal(unauthorizedAdminCreate.status, 401);
  const unconfiguredAuth = await fetch(`${productionServer.baseUrl}/me/courses`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  assert.equal(unconfiguredAuth.status, 503);

  const demoServer = await startApi(true);
  t.after(() => stopApi(demoServer.child));
  const demoHealth = await fetch(`${demoServer.baseUrl}/health`);
  assert.equal((await demoHealth.json()).demo_mode, true);

  const studentLogin = await login(demoServer.baseUrl, 'A.CHEN@UNIVERSITY.EDU', 'student');
  assert.equal(studentLogin.response.status, 200);
  assert.ok(studentLogin.body.token);
  const studentHeaders = { Authorization: `Bearer ${studentLogin.body.token}` };

  const studentAdminList = await fetch(`${demoServer.baseUrl}/admin/course-assignments`, {
    headers: studentHeaders,
  });
  assert.equal(studentAdminList.status, 403);
  const studentAdminCreate = await fetch(`${demoServer.baseUrl}/admin/courses`, {
    method: 'POST',
    headers: { ...studentHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'CS 101', title: 'Intro', facultyId: '00000000-0000-4000-8000-000000000001' }),
  });
  assert.equal(studentAdminCreate.status, 403);

  const courseResponse = await fetch(`${demoServer.baseUrl}/me/courses`, { headers: studentHeaders });
  assert.equal(courseResponse.status, 200);
  assert.ok(Array.isArray(await courseResponse.json()));
  const learningPathResponse = await fetch(`${demoServer.baseUrl}/learning-path`, { headers: studentHeaders });
  const learningPath = await learningPathResponse.json();
  assert.equal(learningPathResponse.status, 200);
  assert.ok(Array.isArray(learningPath));
  assert.ok(learningPath.every((node) =>
    Array.isArray(node.prerequisites) &&
    Number.isFinite(node.estimatedMinutes) &&
    Array.isArray(node.relatedResources) &&
    typeof node.whyNextReason === 'string' &&
    typeof node.practicePrompt === 'string'
  ));
  const assessmentsResponse = await fetch(`${demoServer.baseUrl}/assessments`, { headers: studentHeaders });
  const demoAssessments = await assessmentsResponse.json();
  assert.equal(assessmentsResponse.status, 200);
  assert.ok(demoAssessments.every((assessment) =>
    assessment.questionCount === assessment.questions.length
  ));
  assert.ok(demoAssessments.every((assessment) => assessment.attemptsCount === 0));

  const unavailableProvider = await fetch(`${demoServer.baseUrl}/planner/optimize`, {
    method: 'POST',
    headers: { ...studentHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyTargetHours: 2 }),
  });
  assert.equal(unavailableProvider.status, 503);

  const studentDocumentsResponse = await fetch(`${demoServer.baseUrl}/documents`, { headers: studentHeaders });
  const studentDocuments = await studentDocumentsResponse.json();
  assert.equal(studentDocumentsResponse.status, 200);
  assert.ok(studentDocuments.some((document) => document.id === 'doc_1'));
  assert.ok(studentDocuments.every((document) =>
    document.status === 'UPLOADED' &&
    document.chunksCount === 0 &&
    document.vectorStatus.includes('unavailable') &&
    document.extractedSnippets === undefined
  ));

  const instructorLogin = await login(demoServer.baseUrl, 'elena.rostova@university.edu', 'instructor');
  assert.equal(instructorLogin.response.status, 200);
  const instructorHeaders = { Authorization: `Bearer ${instructorLogin.body.token}` };

  const studentRosterForbidden = await fetch(`${demoServer.baseUrl}/faculty/courses/course_cs201/roster`, {
    headers: studentHeaders,
  });
  assert.equal(studentRosterForbidden.status, 403);
  const demoRoster = await fetch(`${demoServer.baseUrl}/faculty/courses/course_cs201/roster`, {
    headers: instructorHeaders,
  });
  assert.equal(demoRoster.status, 503);

  const instructorSessions = await fetch(`${demoServer.baseUrl}/chat/sessions`, { headers: instructorHeaders });
  assert.equal(instructorSessions.status, 403);
  const foreignConversation = await fetch(`${demoServer.baseUrl}/chat/sessions/session_01/messages`, {
    headers: instructorHeaders,
  });
  assert.equal(foreignConversation.status, 403);
  const demoMessageResponse = await fetch(`${demoServer.baseUrl}/chat/sessions/session_01/messages`, {
    method: 'POST',
    headers: { ...studentHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'test prompt' }),
  });
  assert.equal(demoMessageResponse.status, 503);
  assert.match((await demoMessageResponse.json()).detail, /AI tutor provider is not configured/);
  const demoMessages = await fetch(`${demoServer.baseUrl}/chat/sessions/session_01/messages`, {
    headers: studentHeaders,
  });
  assert.deepEqual(await demoMessages.json(), []);

  const unauthorizedDelete = await fetch(`${demoServer.baseUrl}/documents/doc_1`, { method: 'DELETE' });
  assert.equal(unauthorizedDelete.status, 401);

  const forbiddenDelete = await fetch(`${demoServer.baseUrl}/documents/doc_1`, {
    method: 'DELETE',
    headers: instructorHeaders,
  });
  assert.equal(forbiddenDelete.status, 403);

  const studentFacultyAction = await fetch(`${demoServer.baseUrl}/courses/course_cs201/assessments/generate`, {
    method: 'POST',
    headers: { ...studentHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'AVL trees' }),
  });
  assert.equal(studentFacultyAction.status, 403);

  const invalidId = await fetch(`${demoServer.baseUrl}/documents/invalid%21id`, {
    method: 'DELETE',
    headers: studentHeaders,
  });
  assert.equal(invalidId.status, 400);

  const deleteResponse = await fetch(`${demoServer.baseUrl}/documents/doc_1`, {
    method: 'DELETE',
    headers: studentHeaders,
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });

  const afterReload = await fetch(`${demoServer.baseUrl}/documents`, { headers: studentHeaders });
  const remainingDocuments = await afterReload.json();
  assert.equal(remainingDocuments.some((document) => document.id === 'doc_1'), false);

  const upload = new FormData();
  upload.append('file', new Blob(['course notes'], { type: 'text/plain' }), 'notes.txt');
  upload.append('course_id', 'course_cs201');
  const studentUploadResponse = await fetch(`${demoServer.baseUrl}/courses/course_cs201/documents`, {
    method: 'POST',
    headers: studentHeaders,
    body: upload,
  });
  assert.equal(studentUploadResponse.status, 403);
  const uploadedResponse = await fetch(`${demoServer.baseUrl}/courses/course_cs201/documents`, {
    method: 'POST',
    headers: instructorHeaders,
    body: upload,
  });
  assert.equal(uploadedResponse.status, 202);
  const uploadedDocument = await uploadedResponse.json();
  const uploadedListResponse = await fetch(`${demoServer.baseUrl}/documents`, { headers: instructorHeaders });
  assert.ok((await uploadedListResponse.json()).some((document) => document.id === uploadedDocument.id));

  const missingAgain = await fetch(`${demoServer.baseUrl}/documents/doc_1`, {
    method: 'DELETE',
    headers: studentHeaders,
  });
  assert.equal(missingAgain.status, 404);

  const logoutResponse = await fetch(`${demoServer.baseUrl}/auth/logout`, {
    method: 'POST',
    headers: studentHeaders,
  });
  assert.equal(logoutResponse.status, 200);
  const afterLogout = await fetch(`${demoServer.baseUrl}/me/courses`, { headers: studentHeaders });
  assert.equal(afterLogout.status, 401);
});

test('applies a strict rate limit to demo authentication attempts', async (t) => {
  const demoServer = await startApi(true);
  t.after(() => stopApi(demoServer.child));

  const responses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await fetch(`${demoServer.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@university.edu', role: 'student', password: 'wrong' }),
    });
    responses.push(response.status);
    await response.body?.cancel();
  }

  assert.deepEqual(responses.slice(0, 10), Array(10).fill(401));
  assert.equal(responses[10], 429);
});
