import assert from 'node:assert/strict';
import test from 'node:test';
import { listRecords } from '../server/supabase-repository.js';

function createReadClient(rows) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            range(start, end) {
              calls.push(['range', start, end]);
              return Promise.resolve({ data: rows, error: null });
            },
            eq(column, value) {
              calls.push(['eq', column, value]);
              return this;
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

test('Supabase course rows retain direct fields and expose legacy API aliases', async () => {
  const { client } = createReadClient([{
    id: 'b6f3704f-2d5a-45b0-a6d4-0b4e5512b04c',
    code: 'CS 201',
    title: 'Data Structures',
    instructor_id: 'fa8006d0-722a-45bf-91cd-7b77bd21f9e3',
    created_at: '2026-07-01T10:00:00Z',
  }]);

  const [course] = await listRecords('courses', { client, limit: 10 });

  assert.equal(course.code, 'CS 201');
  assert.equal(course.title, 'Data Structures');
  assert.equal(course.instructorId, 'fa8006d0-722a-45bf-91cd-7b77bd21f9e3');
  assert.equal(course.facultyUid, course.instructorId);
  assert.equal(course.instructorUid, course.instructorId);
  assert.equal(course.createdAt, '2026-07-01T10:00:00Z');
});

test('Supabase repository maps legacy filter fields to database columns', async () => {
  const { client, calls } = createReadClient([]);

  await listRecords('courses', {
    client,
    filters: [['facultyUid', '==', 'fa8006d0-722a-45bf-91cd-7b77bd21f9e3']],
    limit: 10,
  });

  assert.ok(calls.some((call) =>
    call[0] === 'eq' && call[1] === 'instructor_id'
      && call[2] === 'fa8006d0-722a-45bf-91cd-7b77bd21f9e3'));
});

test('profile reads use only columns available in the configured Supabase schema', async () => {
  const { client, calls } = createReadClient([{
    id: 'b6f3704f-2d5a-45b0-a6d4-0b4e5512b04c',
    email: 'student@example.test',
    role: 'student',
    is_approved: true,
    institution_id: null,
  }]);

  const [profile] = await listRecords('profiles', { client, limit: 10 });

  assert.ok(calls.some((call) =>
    call[0] === 'select' && call[1] === 'id,email,role,is_approved,institution_id'));
  assert.equal(profile.role, 'student');
  assert.equal(profile.isApproved, true);
  assert.equal(profile.institutionId, null);
  assert.equal(profile.name, '');
});
