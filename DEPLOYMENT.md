# Deployment

The application has three runtime parts: the Express API and static frontend, the
FastAPI AI service, and the existing Supabase project. Deploy the Express and AI
services separately, with the AI service reachable from Express over a private
service URL where the hosting platform supports one.

## Express and frontend

1. Install Node dependencies with `npm ci`.
2. Build the frontend with `npm run build`.
3. Start the production API and frontend with `npm start`.
4. Use Node.js 24.x and configure the service to provide `PORT` and
   `NODE_ENV=production`.
5. Set `DEMO_MODE=false`.
6. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build
   time. The frontend uses `/api/v1` by default, so the same-origin API needs no
   hard-coded host. Set `VITE_API_BASE_URL` only when intentionally using a
   separately hosted API. Production builds ignore loopback API URLs and fall
   back to `/api/v1`, preventing a local `.env` URL from being embedded in the
   deployed bundle.
7. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SECRET_KEY` as server-side secrets. Keep the secret key out of all
   `VITE_` variables.
8. Set `AI_SERVICE_URL` to the AI service's private URL, not `localhost` when
   the services run in separate containers. Set `CORS_ORIGINS` to the deployed
   web origin(s), without development origins.

## AI service

1. Use Python 3.13.x and install the pinned dependencies with
   `python -m pip install -r ai_service/requirements.txt`.
2. Configure `PORT` and start with `python -m ai_service.serve`.
3. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
   `SUPABASE_SECRET_KEY` as server-side secrets, and set `GROQ_API_KEY` through
   the hosting platform's secret manager.
4. Configure `AI_SERVICE_ORIGINS` for the deployed web origin(s) if browser
   requests are made directly to this service. Normal application AI requests
   should go through the authenticated Express proxy.
5. Verify `/health` reports provider, Supabase, embeddings, and RAG as ready.

## Release checks

- Confirm the Supabase project URL is the intended existing project and all
  required migrations are already applied. This feature uses existing
  `course_materials.metadata`; it adds no migration.
- Use a private Storage bucket and preserve its configured size and MIME limits.
- Run `npm test`, `npm run lint`, `npm run build`, and
  `python -m pytest ai_service/tests` before release.
- Verify API `/api/v1/health`, AI `/health`, and a browser sign-in against
  authorized test accounts. Do not test uploads or deletes using real
  institutional records.
- Configure TLS, host-level secret management, backups, logs, and monitoring
  in the selected hosting platform. This repository does not provision those
  external services.
- The sentence-transformer model is loaded during service startup and may be
  downloaded on first boot. Allow outbound access to the model host and enough
  memory/storage for the embedding runtime; configure a persistent model cache
  if the hosting platform provides one.
