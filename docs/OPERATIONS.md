# Operations Guide

## 1. Deployment options

### Docker Compose (single server)
`docker-compose.yml` runs PostgreSQL 16, the API (Node 22, Alpine, non-root) and the web app (nginx). On start the API applies pending migrations (`prisma migrate deploy`) and then serves on port 4000 inside the network. nginx serves the SPA and proxies `/api`, so cookies stay first-party.

Verified in development (2026-10-27): both images build. The stack starts, migrations apply, `/api/health` responds through nginx, admin sign-in works, SPA deep links are served, and security headers are present. Production hosting, TLS and backups have **not** been exercised.

### Without containers
Build with `npm run build`. Run `node apps/api/dist/server.js` under a process manager (systemd, PM2) with the environment below. Serve `apps/web/dist` from any static server that proxies `/api/` to the API and falls back to `index.html` for unknown paths. `apps/web/nginx.conf` is a working reference.

## 2. Configuration (environment variables)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `NODE_ENV` | yes | `production` in production |
| `API_PORT` | no | Default 4000 |
| `APP_BASE_URL` | yes | Public URL of the web app (used in invitation and reset links) |
| `CORS_ORIGINS` | yes | Comma-separated allowed origins (the public web URL) |
| `COOKIE_SECURE` | yes in production | `true` when served over HTTPS (default when `NODE_ENV=production`) |
| `SESSION_TTL_HOURS` / `SESSION_IDLE_HOURS` | no | Defaults 12 / 4 |
| `STORAGE_DRIVER` / `STORAGE_DIR` | no | `local` (default). Mount `STORAGE_DIR` on persistent storage. The `s3` adapter is not implemented. |
| `MAX_UPLOAD_MB` | no | Default 15 |
| `SMTP_URL` | no | Email transport is not implemented yet; messages are logged |
| `SEED_PASSWORD` | only when seeding | Minimum 12 characters; mandatory in production |
| `LOG_LEVEL` | no | Default `info` (pino JSON logs to stdout) |
| `DISABLE_JOBS` | no | `true` disables the in-process scheduler (escalations, alerts, recurring tasks) |

Run **one** API instance with jobs enabled. If you scale out, set `DISABLE_JOBS=true` on all but one instance.

## 3. Production checklist

- [ ] HTTPS terminates in front of nginx, with `COOKIE_SECURE=true` and HSTS at the edge
- [ ] `POSTGRES_PASSWORD` and the database are not reachable from the internet
- [ ] `SEED_DEMO=false` for live data. Never mix demo and live data in one organisation.
- [ ] The first administrator's password has been changed and MFA enabled for administrators
- [ ] Backups are scheduled and **a restore has been tested** (section 4)
- [ ] Log shipping and alerting are in place for API 5xx responses and failed jobs
- [ ] An independent security review or penetration test is planned. None has been done for this release.

## 4. Backup and recovery

Data lives in two places:
1. **PostgreSQL**, holding all records, ledgers, audit and approvals
2. **The file store** (`STORAGE_DIR`, Docker volume `files`), holding photos and attachments

Back up both, at the same time.

### Database
```bash
# Nightly logical backup (custom format, compressed)
docker compose exec -T db pg_dump -U toprock -d toprock -Fc > backup/toprock-$(date +%F).dump

# Restore into an empty database
docker compose exec -T db createdb -U toprock toprock_restore
docker compose exec -T db pg_restore -U toprock -d toprock_restore --no-owner < backup/toprock-YYYY-MM-DD.dump
```
For point-in-time recovery, enable WAL archiving (`archive_mode=on`) with a tool such as pgBackRest or WAL-G, or use the managed database's PITR.

### Files
```bash
docker run --rm -v cost-controller_files:/data -v "$PWD/backup":/backup alpine \
  tar czf /backup/files-$(date +%F).tgz -C /data .
```

### Suggested policy
| Item | Frequency | Retention |
|---|---|---|
| `pg_dump` | Daily | 30 daily, 12 monthly |
| WAL / PITR | Continuous | 7–14 days |
| File store | Daily (incremental where possible) | Same as database |
| Restore drill | Quarterly | Record the outcome |

Backups should be encrypted at rest and copied off-site.

### Recovery steps
1. Stop the API (`docker compose stop api`) so nothing writes during the restore.
2. Restore the database into a new database and verify it with `SELECT count(*) FROM "CostLedgerEntry";` and a spot-check of recent documents.
3. Restore the file store from the same point in time.
4. Point `DATABASE_URL` at the restored database and start the API. Pending migrations apply automatically.
5. Check the dashboard totals, open approvals and the latest audit events. Record the restore in the audit log of your operations process.

## 5. Migrations

- Migrations are forward-only (`prisma migrate deploy`). Take a backup before each upgrade.
- `npm run db:reset` **drops the database** and is for development only.
- The `append_only_guards` migration adds triggers that reject UPDATE/DELETE on ledger and audit tables. Corrections are made with reversal entries through the application.

## 6. Monitoring

- `GET /api/health` is the liveness check, used by the container healthcheck.
- Logs are JSON on stdout (pino). pino-http logs every request with an id, status and duration (health checks excluded).
- Watch for bursts of HTTP 429 (rate limit), 403 (`FORBIDDEN`) or 422 (`BUSINESS_RULE`) responses and for job errors in the logs.
