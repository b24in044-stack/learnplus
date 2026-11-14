# Deployment

The application has three runtime parts: the Express API and static frontend, the
FastAPI AI service, and the existing Supabase project. Deploy the Express and AI
services separately, with the AI service reachable from Express over a private
service URL where the hosting platform supports one.

## Render Blueprint

The root `render.yaml` defines three Render services from the `main` branch:

1. `learnplus-ai-b24in044`, a private Python service in Singapore.
2. `learnplus-api-b24in044`, the Express API in Singapore.
3. `learnplus-frontend-b24in044`, the static Vite frontend.

The AI service is private and its Render-provided private `host:port` address is
passed to Express. Keep all three services in the same Render workspace and
region. The static site calls the API at
`https://learnplus-api-b24in044.onrender.com/api/v1`; the API CORS allowlist is
restricted to the configured frontend origin.

To create the services, sign in to Render, choose **New > Blueprint**, connect
`b24in044-stack/learnplus`, select branch `main`, and apply the root
`render.yaml`. Enter the prompted Supabase publishable key for the frontend and
the server-side Supabase publishable key, Supabase secret key, and Groq API key
for the backend services using Render's secret inputs. Never put secret values
in this file, GitHub, or a `VITE_` variable. The Supabase URL is preconfigured
for the existing project `nolqcxsitmdkeremwvqa`; do not replace it.

The blueprint sets the API plan to `0.5c-512mb` and the private AI plan to
`1c-2g`; both are paid Render compute plans. Review Render's current pricing
before applying the Blueprint. The static site is free. Do not select or apply
the Blueprint if the displayed cost is not approved.

Deployments should become healthy in dependency order: private AI service, API,
then frontend. Render private services do not expose a public health URL and
support TCP health checks only. Verify the private AI `/health` endpoint from
the API service's shell or through an authenticated AI request from the
frontend. Verify the API with
`https://learnplus-api-b24in044.onrender.com/api/v1/health` and the frontend at
`https://learnplus-frontend-b24in044.onrender.com/`. The API health response
must report `status: "ok"` and `supabase_connected: true`; the AI health
response must report provider and Supabase connectivity and embedding
availability.

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
