# Student data and Supabase

Supabase Auth is the source of user identity. The UUID in `auth.users` is also the primary key for `public.profiles` and the owner/foreign-key value for student data. Application roles are stored in `profiles.role`. After validating a Supabase access token, the API creates a missing profile as a student using only the columns required by the deployed profile schema. Faculty access requires a server-validated invite and is granted by the trusted API; never accept a role or owner ID from an untrusted request.

The canonical relational schema and row-level security policies are defined in `supabase/migrations`. Link the Supabase CLI to the project and apply the schema before starting the API:

```powershell
npx supabase link --project-ref <project-ref>
npx supabase db push
```

The `202611080001_repair_auth_profile_trigger` migration replaces duplicate auth-user profile triggers with one handler that supports both the deployed and canonical profile columns. It is applied and recorded in the Supabase migration history.

The `202611080002_restore_profile_self_read` migration restores authenticated users' ability to read their own profile after a profiles-table reset. The API also checks the trusted profile record before creating a missing student profile, preventing an RLS-hidden administrator profile from being downgraded.

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the frontend. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` for the Express and AI services. The secret key is server-only; never use a `VITE_` prefix for it. `SUPABASE_SERVICE_ROLE_KEY` remains supported as a server-side compatibility alias.

The `legacy_id` columns retain source record IDs when importing records. Supabase-generated UUIDs are used for relational references; resolve imported references by their legacy IDs rather than assuming source IDs are UUIDs. Passwords cannot be transferred between identity providers; users moving from another provider must create or activate a Supabase account and set a new password.

Student academic routes enforce enrollment, publication, answer-key release-time, and verified-result rules. Student File Storage is disabled, and only authenticated faculty can upload course materials. Storage downloads use short-lived Supabase signed URLs; configure the `course-materials` and `student-documents` buckets and their policies before enabling uploads.

Set `FACULTY_INVITE_CODE` in the Express server's private environment. Faculty applicants must enter this code when registering; the server validates it and uses its privileged profile-provisioning function to grant the faculty role. Keep the code out of all `VITE_` variables and frontend files. If Supabase email confirmation is enabled, applicants must enter the invite code again when signing in after confirming their email so the server can activate the faculty profile.

Administrator accounts are not self-service. Create or select a trusted account in Supabase Auth, then grant it administrator access by updating its matching profile in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin', is_approved = true
where id = (
  select id from auth.users where email = 'admin@your-institution.edu'
);
```

Only a trusted project owner should run this statement. Administrators can create courses and assign them to existing faculty profiles from the Administrator portal.
