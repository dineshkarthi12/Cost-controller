# Deploying on Vercel

The repository deploys to Vercel as **one project**. The web app is served as static files, and the API runs as one serverless function (`api/index.js`). `vercel.json` and `scripts/vercel-build.mjs` hold all the settings, so nothing needs to be typed into build settings.

## Steps (they can all be done from a phone)

### 1. Import the repository as a single project
1. Vercel → **Add New… → Project** → import **Cost-controller**.
2. If Vercel shows "Multiple applications detected" with *apps/api* and *apps/web*, do **not** import either one separately and do **not** use *Import multi-service project*. Instead set **Root Directory** to the top folder (`./`, i.e. `Cost-controller` itself).
3. Framework preset: **Other**. Leave the build, output and install commands empty, because `vercel.json` provides them.
4. Click **Deploy**. This first deployment succeeds but has no database yet. The build log says *"DATABASE_URL is not set: skipping migrations and seed"*. That is expected.

### 2. Add a database (Postgres)
1. Project → **Storage** → **Create Database** → **Neon (Serverless Postgres)** → create, then **Connect** it to this project for all environments.
2. This adds `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and related variables automatically. Vercel Postgres and Supabase names (`POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`) and custom prefixes (e.g. `STORAGE_DATABASE_URL`) are recognised too. The build uses the unpooled one for migrations, and the app uses the pooled one at runtime.

### 3. Add file storage (photos, attachments, drawings)
1. Project → **Storage** → **Create** → **Blob**. Choose access **Private**, then **Connect** it to this project.
2. This adds `BLOB_READ_WRITE_TOKEN`. Without it the app still works, but uploads are refused with a clear message instead of being lost.

### 4. Add environment variables
Project → **Settings → Environment Variables**:

| Name | Value | Why |
|---|---|---|
| `SEED_PASSWORD` | A strong password, 12+ characters | Password for `admin@toprock.example` (and the demo users, if enabled) |
| `ADMIN_EMAIL` | Your own email (optional) | Creates an extra administrator with this email and the `SEED_PASSWORD` password |
| `ADMIN_NAME` | Your name (optional) | Display name for that administrator |
| `SEED_DEMO` | `true` for a demo site, otherwise leave unset | Creates the clearly-flagged demo projects and users |
| `CRON_SECRET` | Any long random string | Protects the daily scheduled-jobs endpoint |
| `APP_BASE_URL` | `https://<your-project>.vercel.app` | Used in invitation and password-reset links |
| `CORS_ORIGINS` | Same as `APP_BASE_URL` | Allowed browser origin |

### 5. (Optional) Email from your Gmail
1. Google account → **Security** → turn on **2-Step Verification** → search **App passwords** → create one named "TOPROCK". Google shows a 16-letter password.
2. Vercel → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | the 16-letter app password (spaces are fine) |
| `EMAIL_FROM` | `TOPROCK GLOBAL <your Gmail address>` |

3. Redeploy, then in the app: **Integrations → Send test email to me**.

To move to the company mailbox later, replace these five values with the ones from your IT team (for Microsoft 365: `smtp.office365.com`, port `587`) and redeploy. No code change is needed.

### 6. Redeploy
**Deployments** → the latest deployment → **⋯ → Redeploy**. The build log should show:
- `prisma migrate deploy` → *All migrations have been successfully applied*
- the seed → *Reference data ready…* (and the demo steps if `SEED_DEMO=true`)

Then open the site and sign in as **admin@toprock.example** with your `SEED_PASSWORD`. Change the password under *My account* and turn on MFA.

Later deployments re-run migrations (only new ones) and the seed. The seed never overwrites existing data, so redeploying is safe.

## Troubleshooting sign-in

Open `https://<your-project>.vercel.app/api/health` in the browser:

| It shows | Meaning | Fix |
|---|---|---|
| `DATABASE_NOT_CONFIGURED` | No database variable reached this deployment | Storage → connect a Neon Postgres database with **Production** ticked → Redeploy |
| `DATABASE_UNAVAILABLE` | A database is configured (the variable name is shown) but cannot be reached | Check the database is active in Storage; wait a minute (Neon wakes up from sleep) and retry |
| `DATABASE_NOT_MIGRATED` | Database connected after the last build, so tables were never created | Deployments → ⋯ → Redeploy |
| `"setup":"no users yet…"` | `SEED_PASSWORD` was missing at build time | Add `SEED_PASSWORD` (and optionally `ADMIN_EMAIL`) → Redeploy |
| `"status":"ok"` with `"setup":"complete"` | Ready | Sign in with `admin@toprock.example` (or your `ADMIN_EMAIL`) and `SEED_PASSWORD` |

The sign-in page shows the same messages. "Invalid email or password" means the server works; check the email and password.

**Forgot the password, or the account is locked** (5 wrong attempts lock it for 15 minutes)? Set `SEED_PASSWORD` to the new password, add `RESET_ADMIN_PASSWORD` = `true`, and redeploy. The administrator accounts (`admin@toprock.example` and `ADMIN_EMAIL`) get the new password, are unlocked, and are signed out everywhere. The reset is recorded in the audit trail. **Delete `RESET_ADMIN_PASSWORD` afterwards**, otherwise every deployment resets the password again.

## What runs differently on Vercel

| Topic | On Vercel |
|---|---|
| Background jobs (escalations, overdue alerts, recurring tasks) | Run by **Vercel Cron** once a day (`/api/cron/jobs`, 01:30 UTC). The Hobby plan allows daily crons only; on Pro you can change the schedule in `vercel.json`. |
| Upload size | Vercel limits each request to about **4.5 MB**. The app shrinks large photos in the browser before upload and sends attachments one at a time. PDFs and drawings larger than about 4 MB cannot be uploaded on Vercel; use the Docker deployment for very large drawings. |
| File storage | Vercel Blob (private). The local `storage/` folder is not used. |
| Function time limit | 60 seconds per request (`vercel.json`). Large report exports normally take a few seconds. |
| Database connections | The pooled Neon connection is used at runtime, with Prisma's `pgbouncer=true` applied automatically. |

## How this was verified, and what was not

Verified in the development environment:
- The build script ran under `VERCEL=1` against a new empty database: web build, API bundle, all migrations, and the full demo seed.
- The function bundle was traced with Vercel's file tracer (`@vercel/nft`). The Prisma engine, schema, PDF logo, Blob SDK and all dependencies were included.
- The function handler was run in production mode. Health, sign-in (cookie `HttpOnly; Secure; SameSite=Lax`), dashboard, PDF export, the cron endpoint (wrong or missing secret → 404) and the clear "storage not configured" upload error all behaved correctly.
- Browser photo shrinking: a 13.1 MB photo became 2.6 MB.

Not verified: an actual deployment on vercel.com, which needs your Vercel account. Uploads to a real Vercel Blob store were also not tested, because no Blob token was available here. If a step fails, the build log or the error message on screen will name the missing setting; send it to me.
