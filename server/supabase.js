import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

const requestClientContext = new AsyncLocalStorage();

function configuration() {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { url, publishableKey, secretKey };
}

export function isSupabaseConfigured() {
  const { url, publishableKey, secretKey } = configuration();
  return Boolean(url && publishableKey && secretKey);
}

export function createUserSupabaseClient(accessToken) {
  const { url, publishableKey } = configuration();
  if (!url || !publishableKey) {
    throw new Error('Supabase user access is not configured on this server.');
  }
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 8192) {
    throw new Error('A valid Supabase access token is required.');
  }
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

let adminClient;

export function getAdminSupabaseClient() {
  const { url, secretKey } = configuration();
  if (!url || !secretKey) {
    throw new Error('Supabase trusted server access is not configured.');
  }
  if (!adminClient) {
    adminClient = createClient(url, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

export function runWithSupabaseRequestClient(client, callback) {
  return requestClientContext.run(client, callback);
}

export function getSupabaseRequestClient() {
  const client = requestClientContext.getStore();
  if (!client) {
    throw new Error('A user-scoped Supabase client is required for this request.');
  }
  return client;
}

export function getOptionalSupabaseRequestClient() {
  return requestClientContext.getStore() || null;
}

export async function writeAuditLog({ institutionId, actorId, action, entityType, entityId, details = {} }) {
  if (!isSupabaseConfigured()) return;
  const { error } = await getAdminSupabaseClient()
    .from('audit_logs')
    .insert({
      institution_id: institutionId || null,
      actor_id: actorId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details,
    });
  if (error) throw error;
}

export async function notifyCourseStudents({
  courseId,
  institutionId,
  type,
  title,
  body,
  entityType,
  entityId,
}) {
  const adminClient = getAdminSupabaseClient();
  const { data: enrollments, error: enrollmentError } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('course_id', courseId)
    .in('status', ['active', 'enrolled']);
  if (enrollmentError) throw enrollmentError;
  if (!enrollments?.length) return;
  const { error } = await adminClient.from('notifications').upsert(
    enrollments.map(({ student_id: recipientId }) => ({
      recipient_id: recipientId,
      institution_id: institutionId || null,
      type,
      title,
      body,
      entity_type: entityType || null,
      entity_id: entityId || null,
    })),
    { onConflict: 'recipient_id,type,entity_type,entity_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function notifyProjectParticipants({
  projectId,
  institutionId,
  type = 'feedback',
  title,
  body,
  entityType = 'project',
  entityId = projectId,
  excludeUserId,
}) {
  const adminClient = getAdminSupabaseClient();
  const [{ data: project, error: projectError }, { data: members, error: memberError }] = await Promise.all([
    adminClient.from('projects').select('created_by,guide_id').eq('id', projectId).maybeSingle(),
    adminClient.from('project_members').select('student_id').eq('project_id', projectId),
  ]);
  if (projectError) throw projectError;
  if (memberError) throw memberError;
  const recipientIds = new Set([
    project?.created_by,
    project?.guide_id,
    ...(members || []).map((member) => member.student_id),
  ].filter((id) => id && id !== excludeUserId));
  if (!recipientIds.size) return;
  const { error } = await adminClient.from('notifications').upsert(
    [...recipientIds].map((recipientId) => ({
      recipient_id: recipientId,
      institution_id: institutionId || null,
      type,
      title,
      body,
      entity_type: entityType,
      entity_id: entityId,
    })),
    { onConflict: 'recipient_id,type,entity_type,entity_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function notifyUsers({ recipientIds, institutionId, type, title, body, entityType, entityId }) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return;
  const { error } = await getAdminSupabaseClient().from('notifications').upsert(
    ids.map((recipientId) => ({
      recipient_id: recipientId,
      institution_id: institutionId || null,
      type,
      title,
      body,
      entity_type: entityType || null,
      entity_id: entityId || null,
    })),
    { onConflict: 'recipient_id,type,entity_type,entity_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

function isMissingInstitutionColumn(error) {
  return error?.code === '42703'
    || (typeof error?.message === 'string' && error.message.includes('institution_id'));
}

export function isSupabaseSchemaUnavailable(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === '42P01'
    || code === '42703'
    || code === '42883'
    || (typeof error?.message === 'string'
      && (/relation .* does not exist/i.test(error.message)
        || /column .* does not exist/i.test(error.message)
        || /function .* does not exist/i.test(error.message)));
}

async function loadProfile(client, userId) {
  const primary = await client
    .from('profiles')
    .select('id,email,role,institution_id,is_approved')
    .eq('id', userId)
    .maybeSingle();
  if (!primary.error) return primary;
  if (!isMissingInstitutionColumn(primary.error)) return primary;

  const legacy = await client
    .from('profiles')
    .select('id,email,role,is_approved')
    .eq('id', userId)
    .maybeSingle();
  if (!legacy.error) return legacy;
  if (!isMissingInstitutionColumn(legacy.error)) return legacy;

  return client
    .from('profiles')
    .select('id,email,role')
    .eq('id', userId)
    .maybeSingle();
}

export async function authenticateSupabaseToken(accessToken) {
  const client = createUserSupabaseClient(accessToken);
  const { data: authData, error: authError } = await client.auth.getUser(accessToken);
  if (authError) throw authError;
  if (!authData.user) return null;

  const { data: profile, error: profileError } = await loadProfile(
    getAdminSupabaseClient(),
    authData.user.id,
  );
  if (profileError) throw profileError;
  if (!profile || !['student', 'faculty', 'admin'].includes(profile.role)) return null;
  if (typeof profile.is_approved !== 'boolean') {
    const error = new Error('The trusted application profile does not expose an approval status.');
    error.status = 503;
    error.code = 'approval_status_unavailable';
    throw error;
  }

  return {
    client,
    requestedRole: authData.user.user_metadata?.requested_role,
    user: {
      id: profile.id,
      name: authData.user.user_metadata?.full_name || '',
      email: profile.email || authData.user.email || '',
      role: profile.role === 'faculty' ? 'instructor' : profile.role,
      institutionId: profile.institution_id || '',
      isApproved: profile.is_approved,
      avatarUrl: '',
      department: '',
      enrolledSince: '',
    },
  };
}

export async function provisionSupabaseProfile(userId, role) {
  const { data, error } = await getAdminSupabaseClient()
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id,email,role')
    .single();
  if (error) throw error;
  await writeAuditLog({
    institutionId: null,
    actorId: userId,
    action: 'profile_role_changed',
    entityType: 'profile',
    entityId: userId,
    details: { role },
  });
  return data;
}
