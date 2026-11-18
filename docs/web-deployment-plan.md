# Plan: deploy `web` to the VPS and retire the old landing page

Status: **Phase 1 analysis done from the repositories; three points need a VPS check or your decision before Phase 3.** Nothing has been changed on the VPS.

Sources read: `ARCHITECTURE.md`, `CI-CD-PIPELINE.md`, `docker-compose.yml`, `deploy/docker-compose.prod.yml`, `Dockerfile`, `docker-entrypoint.sh`, `Jenkinsfile`, `deploy/ansible/**`, `.github/workflows/ci.yml`, `nginx/dermee.conf`, `docker-deploy.sh` (all on `main` and on `feature/admin-dashboard`), the `web` repository, and your `docker ps` output.

---

## 1. Findings that change the plan

### 1.1 Production is not run by the documented Jenkins → GHCR → Ansible flow

`CI-CD-PIPELINE.md` describes this flow:
- Jenkins builds `ghcr.io/…/dermeee-api:<sha>`.
- Ansible copies `deploy/docker-compose.prod.yml` to `/opt/dermeee` and runs it.

Your running containers don't match that.

| Evidence | What it means |
|---|---|
| Images are `backend-api` and `backend-frontend`, not `ghcr.io/…/dermeee-*` | Compose built them from source, with project name `backend`. Only the root `docker-compose.yml` has `build:` sections; the prod file uses `image:` |
| `dermee-postgres` publishes `0.0.0.0:5432` | Only the root `docker-compose.yml` maps port 5432. The prod file does not publish it |
| `dermee-api` was created 5 weeks ago | Matches commit `bff307d` (13 Oct, "fix 502 bad gateway"), which edited the root `docker-compose.yml` (`env_file: .env`) |
| `dermee-frontend` was created 7 months ago | Built from `../frontend` by the root compose `frontend` service |
| Both compose files use `container_name: dermee-api` | If Ansible ran the prod file, the container names would clash with the running ones and `up` would fail |

**Most likely reality:** a checkout of `backend` sits next to a checkout of `frontend` on the VPS, and someone runs `docker compose up -d --build <service>` in the backend folder, which reads `backend/.env`. Jenkins may exist and push images, but it isn't what runs production.

This matters because "follow the backend's deployment logic" means two different things depending on which flow is real. §6 gives one plan for each. Command block A in §9 decides which applies.

### 1.2 The new web app needs the new backend, which needs database migrations

`web` was built against `backend` branch `feature/admin-dashboard`, which is **not deployed**. Production runs `main`, and on `main`:
- every `/admin/*` endpoint is missing;
- the product, cart and order APIs are a stub, or exist only on the merged branch;
- the doctor directory fields, chat conversations, notifications, reservation states and references, private files, and "view as user" are all missing.

Deployed alone, the new site would load and let people sign in. The admin area, the shop, chat and parts of booking would fail.

The backend upgrade includes **9 Prisma migrations**:
- 2 "catch-up" migrations that are marked as already applied, not run;
- 7 new ones that add tables and columns, change two enums and backfill data.

That conflicts with your rule "never modify database data or schemas". It needs your explicit approval as a separate, backed-up step, following `ARCHITECTURE.md` §14. I have tested these migrations end to end on an empty Postgres, and they produce exactly `schema.prisma`. They have **not** been run against a copy of production data.

### 1.3 The new app's pages collide with the API paths on `dermee.dz`

The live routing (from `nginx/dermee.conf`) sends these prefixes to the API on `:3000`: `/auth`, `/doctor`, `/product`, `/appointment`, `/api`, `/health`. Everything else goes to `:3001`. Nginx prefix matching means `location /doctor` also catches `/doctors`.

| New web page | Caught by | Result |
|---|---|---|
| `/doctor`, `/doctor/appointments`, `/doctor/schedule`, … (doctor area) | `location /doctor` | Served by the API: JSON or 404 |
| `/doctors`, `/doctors/:id` (public directory) | `location /doctor` | Same |
| `/auth/callback` (Google/Facebook return) | `location /auth` | 404 from the API |
| everything else (`/`, `/login`, `/admin/*`, `/patient/*`, `/shop/*`) | `location /` | Works |

So Nginx needs a change in any case; §5 has the options.

The new app also calls API paths that the main domain doesn't route today: `/admin/*`, `/patients`, `/users`, `/messages`, `/notifications`, `/cart`, `/orders`, `/files`, `/uploads`, `/impersonation` and `/socket.io`. Two of them, `/admin` and `/doctor`, are also page paths in the app.

---

## 2. Current production architecture (to be confirmed with §9 A)

```
Internet ── Nginx (host, :80/:443, certbot) ── dermee.dz / www.dermee.dz
             ├─ /auth /doctor /product /appointment /api /health ──► 127.0.0.1:3000  dermee-api (backend-api image)
             ├─ /github-webhook ──► 127.0.0.1:8080 Jenkins
             └─ /  ──► 127.0.0.1:3001  dermee-frontend (backend-frontend image, old landing page)
Docker network dermee-network (bridge): dermee-api ──► dermee-postgres:5432 (volume postgres_data)
Published ports: 3000, 3001, 5432 on 0.0.0.0
Restart policy: unless-stopped (all). Logging: Docker default (json-file).
Healthchecks: api (compose override, accepts 200/404), postgres (pg_isready); old frontend has none.
Secrets: backend/.env on the VPS (env_file), never committed.
CI: GitHub Actions (lint, format, build). CD: Jenkins + Ansible exist in the repo (see 1.1).
```

## 3. The new web app: production requirements

| | |
|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript, Tailwind 4 |
| Node / package manager | Node 20 (Docker `node:20-alpine`), npm (`package-lock.json`) |
| Build / run | `npm ci && npm run build`, then `node server.js` (`output: 'standalone'`) on port **3001** |
| Dockerfile | Present: 3 stages, non-root user `nextjs` (uid 1001), `HEALTHCHECK` on `/login`. Same pattern as the backend image |
| Configuration | One variable, `NEXT_PUBLIC_API_URL`. It is **baked into the bundle at build time** (build arg), and there are no runtime secrets |
| API calls | All from the browser (`src/lib/api.ts`). The Next server never calls the API, so the web container has no network dependency on `dermee-api` |
| Auth | Bearer access and refresh tokens from `/auth/login` in `localStorage`, plus a separate impersonation token in `sessionStorage`. **No cookies are used** for auth, so there are no cookie, SameSite or Secure settings to manage. One cookie, `dermee_locale`, stores the language |
| OAuth | Buttons link to `${API_URL}/auth/google`. The backend redirects to `OAUTH_SUCCESS_REDIRECT` with tokens, and the page `/auth/callback` stores them |
| Real-time | Socket.IO for notifications and chat, connected to `API_URL` |
| Files | `/uploads/*` is public and loaded from `API_URL`. Medical files come from `/files/*` with the Bearer token |
| Routing | Server-rendered on demand (`ƒ` routes). Refreshing any URL works because Next serves it, so no `try_files` fallback is needed |

## 4. Recommended approach in one line

Run the web app as a sibling service in the **same** compose project and Docker network, with the same naming and restart conventions. Point the existing Nginx `location /` at it after testing it side by side. Give the web app **one new same-origin API prefix**. Retire `dermee-frontend` last, keeping it for rollback.

## 5. Routing: choose one (decision 1)

All three options keep the same domain, the same certificate, the API on `:3000` and Swagger at `/api`.

**R1 (recommended): one new API prefix, and narrow the two colliding legacy locations.**
- Add `location /api/v1/`, proxying to `http://127.0.0.1:3000/` with the prefix stripped and WebSocket upgrade enabled. Only the new app uses it: `NEXT_PUBLIC_API_URL=https://dermee.dz/api/v1`.
  - Same origin means **no CORS involvement**, no new DNS record and no new certificate.
- Replace `location /auth` with `location /auth/google` and `location /auth/facebook`, so the OAuth callback URLs registered with Google and Facebook keep working. `/auth/callback` then reaches the web app.
- Remove `location /doctor` so the doctor area and `/doctors` reach the web app.
- Keep `/product`, `/appointment`, `/api` (Swagger), `/health` and `/github-webhook` unchanged.
- **Risk:** any other client (a mobile app?) that calls `https://dermee.dz/doctor/...` or `https://dermee.dz/auth/login` breaks. It would have to use `/api/v1/doctor/...`. **Please confirm whether any client other than the old landing page uses these paths.**

**R2 (zero change to existing locations): rename the app's colliding pages.**
- Add only the `/api/v1/` location.
- Rename the app routes: `/doctor` → `/medecin`, `/doctors` → `/medecins`, `/auth/callback` → `/oauth/callback`.
- No legacy path changes at all. The cost is French URLs in a three-language app, and the app's route names no longer matching the API's.

**R3 (API subdomain `api.dermee.dz`): not recommended.**
- It needs a DNS record, a new certificate and CORS configuration.
- The `/doctor` and `/auth` collisions on `dermee.dz` still need R1's removal anyway.
- The extra server block for it is on the `feature/admin-dashboard` branch. I would remove it from that branch if you choose R1 or R2.

## 6. Exact changes

### 6.1 `web` repository (both deployment flows)

| File | Change |
|---|---|
| `src/lib/socket.ts` | Derive the Socket.IO `path` from `NEXT_PUBLIC_API_URL`, so `https://dermee.dz/api/v1` connects on `/api/v1/socket.io` instead of being read as a namespace. About 5 lines |
| `Dockerfile` | No change |
| `.github/workflows/ci.yml` (new) | Same shape as the backend CI: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` on push and PR |
| `Jenkinsfile` (new, **only if the Jenkins flow is real**, see 6.3) | A copy of the backend's, building `${DOCKER_REGISTRY}/dermeee-frontend:<sha>` |
| `README.md` | Production section matching what is decided |
| R2 only | Rename three route folders and their links |

### 6.2 If production is the root `docker-compose.yml` (most likely, see 1.1)

On the VPS, clone `web` next to the existing checkouts, so `../web` sits beside `backend` and `frontend`. Then add one service to `backend/docker-compose.yml` and leave `frontend` untouched until cut-over:

```yaml
  web:
    build:
      context: ../web
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${WEB_PUBLIC_API_URL:-https://dermee.dz/api/v1}
    container_name: dermee-web
    restart: unless-stopped
    environment:
      NODE_ENV: production
    ports:
      - "127.0.0.1:${WEB_PORT:-3002}:3001"   # loopback only: only the host Nginx needs it
    networks:
      - dermee-network
```

- Deploy it with `docker compose up -d --build --no-deps web`. `--no-deps` guarantees `dermee-api` and `dermee-postgres` are not touched.
- Cut-over is one change in the live Nginx config: `location /` goes from `127.0.0.1:3001` to `127.0.0.1:3002`, followed by `nginx -t && systemctl reload nginx`. There is no downtime, and rolling back is the reverse edit.
- After a validation period: `docker compose stop frontend`, and then the `frontend` service is removed from the file in a separate commit. The old image `backend-frontend` is kept for rollback until you decide to delete it.
- Future web-only deploys: `git -C ../web pull && docker compose up -d --build --no-deps web`. This is exactly how the API is deployed today.

### 6.3 If the Jenkins → GHCR → Ansible flow is the real one

`docker-compose.prod.yml` already has a `frontend` service with `image: ${DOCKER_REGISTRY}/dermeee-frontend:${FRONTEND_IMAGE_TAG}` and a comment "frontend lives in another repo with its own pipeline". So the minimal extension is:

- A `web` Jenkinsfile, copied from the backend's. It builds `--build-arg NEXT_PUBLIC_API_URL=…`, then tags and pushes `dermeee-frontend:<sha>`, `:latest`, and runs the **same** playbook with `-e compose_services=frontend -e image_tag_var=FRONTEND_IMAGE_TAG`.
- `deploy/ansible/playbooks/deploy.yml` (backend repo): make the tag variable name a parameter (default `API_IMAGE_TAG`). Today it always writes `API_IMAGE_TAG`. With that change the backend pipeline behaves exactly as before.
- One Jenkins job "dermee-web" (Pipeline from SCM, `Jenkinsfile`) plus the GitHub webhook to `/github-webhook/`. It reuses the existing credentials `docker-registry-credentials` and `vps-ssh-deploy-key`, so no new secrets are needed.

Your brief says "GitHub Actions builds the image". In this repo GitHub Actions only runs CI, and the image build and deploy belong to Jenkins. I would keep that split. Please confirm, or tell me if you really want the image built in GitHub Actions, which would be a new deployment path.

### 6.4 Nginx (live file on the VPS, backed up first)

The repository file has only `listen 80`. Certbot normally adds the 443 / SSL / redirect blocks to the **live** file, so I'll write the edits against the output of `nginx -T` (§9 B), not the repository copy, and then update the repository copy to match.

For R1:
```nginx
# NEW — API for the new web app, same origin, prefix stripped, WebSockets for Socket.IO
location /api/v1/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # map defined once at http level
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;          # streamed CSV/Excel exports
    client_max_body_size 20m;     # document uploads (API cap: 15 MB)
}
# CHANGED — /auth narrowed to the OAuth routes; /doctor removed (now pages of the web app)
location /auth/google   { …same proxy block as today… }
location /auth/facebook { …same proxy block as today… }
# CHANGED at cut-over — location / { proxy_pass http://127.0.0.1:3002; }  (was :3001)
# UNCHANGED — /product, /appointment, /api, /health, /github-webhook
```

### 6.5 Backend: environment only (no code change for the frontend)

| `backend/.env` key | Value |
|---|---|
| `OAUTH_SUCCESS_REDIRECT` | `https://dermee.dz/auth/callback` (R2: `/oauth/callback`) |
| `ALLOWED_ORIGINS` | No change needed for same-origin calls. Keep `https://dermee.dz,https://www.dermee.dz` |
| `NODE_ENV` | Must stay `production` (compose sets it), so online visits require Google Meet credentials |

Changing `.env` recreates `dermee-api` (about 10 to 20 s). Do it during the backend upgrade (§7), not separately.

## 7. The backend upgrade (decision 2, needs explicit approval)

This must happen before or together with the web cut-over (§1.2). Proposed order, all following `ARCHITECTURE.md` §14:

1. **Back up.**
   - Database: `pg_dump -Fc`.
   - Uploaded files: `docker cp dermee-api:/app/uploads ./uploads-backup`. Today they live inside the API container and would be lost on any recreate.
2. **Read-only drift check** of production against `prisma/baseline/schema-at-sync.prisma`. It must print nothing.
3. **Tag the current image for rollback:** `docker tag backend-api backend-api:pre-admin`.
4. **Commit, review and merge** `feature/admin-dashboard`, then pull it on the VPS.
5. **Mark the catch-up migrations as applied** (`migrate resolve --applied`).
6. **Rebuild and recreate only the API:** `docker compose up -d --build --no-deps api`. The entrypoint applies the 7 new migrations. Postgres is not restarted.
7. **Create the first admin** (`node dist/cli/create-admin.js`), restore the uploads into the new volume, and set stock for existing products.

**Rollback:**
- Code: `backend-api:pre-admin`.
- Schema: restore the dump. Migrations only go forward, so data written after the upgrade would be lost. Plan a quiet hour for it.

## 8. Deployment sequence and rollback (after your approval)

| Step | Action | Touches api/db? | Rollback |
|---|---|---|---|
| 0 | Backups (§7.1) and an Nginx copy: `cp /etc/nginx/sites-available/dermee.conf ~/dermee.conf.bak-$(date +%F)` | no | — |
| 1 | Backend upgrade (§7) | api recreated once | §7 |
| 2 | `git clone` web, add the `web` service, `docker compose up -d --build --no-deps web` | **no** | `docker compose stop web` |
| 3 | Test on loopback: `curl -I http://127.0.0.1:3002/login`. In a browser, use `ssh -L 3002:127.0.0.1:3002 vps` and open `http://localhost:3002` (API calls go to the real `https://dermee.dz/api/v1`) | no | — |
| 4 | Add the `/api/v1/` location only, then `nginx -t && reload`. The old site is untouched | no | remove the block |
| 5 | Repeat the step 3 checks: sign in as admin, patient and doctor; booking; a live notification; a file upload | no | — |
| 6 | Cut-over: R1 location edits + `location /` → `:3002`, then `nginx -t && reload` | no | restore the `.bak` file, reload (seconds) |
| 7 | Verify the domain (§10) and that api and postgres show no restarts (`docker ps` uptime unchanged since step 1) | no | step 6 rollback |
| 8 | After a few days: `docker compose stop frontend` (do **not** `rm` the image yet), then remove the service in git | no | `docker compose start frontend` + restore Nginx |

## 9. Read-only commands to run on the VPS (please paste the output)

These change nothing. They complete Phase 1 and decide between §6.2 and §6.3.

```bash
# A. Which compose file / directory created each container (decides 6.2 vs 6.3)
for c in dermee-api dermee-postgres dermee-frontend; do
  docker inspect "$c" --format '{{.Name}} image={{.Config.Image}} project={{index .Config.Labels "com.docker.compose.project"}} dir={{index .Config.Labels "com.docker.compose.project.working_dir"}} files={{index .Config.Labels "com.docker.compose.project.config_files"}} restart={{.HostConfig.RestartPolicy.Name}}'
done
docker network ls; docker volume ls
docker inspect dermee-api --format 'networks={{json .NetworkSettings.Networks}} mounts={{json .Mounts}}'
docker inspect dermee-postgres --format 'mounts={{json .Mounts}}'
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | head -20
systemctl is-active jenkins; ls -la /opt/dermeee 2>/dev/null

# B. Live Nginx (includes certbot's SSL edits) and certificates
sudo nginx -T 2>/dev/null | grep -nE 'server_name|listen|ssl_certificate|location|proxy_pass|return 301|map '
sudo certbot certificates

# C. Checkout state in the compose directory from A (replace <dir>)
cd <dir> && git log --oneline -3 && git status --short | head && ls ..

# D. Environment: names only, plus the non-secret URLs
grep -oE '^[A-Z_]+=' .env | tr -d '=' | sort | tr '\n' ' '; echo
grep -E '^(ALLOWED_ORIGINS|OAUTH_GOOGLE_CALLBACK_URL|OAUTH_FACEBOOK_CALLBACK_URL|OAUTH_SUCCESS_REDIRECT)=' .env

# E. Data that a backend redeploy would lose, and migration state (read only)
docker exec dermee-api sh -c 'find /app/uploads -type f 2>/dev/null | wc -l; du -sh /app/uploads 2>/dev/null'
docker exec dermee-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select migration_name from _prisma_migrations order by 1" 2>&1; psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from \"User\"; select count(*) from \"Order\";"'

# F. Firewall (context for the public 5432, see §11)
sudo ufw status verbose
```

## 10. Verification after cut-over

```bash
curl -sI https://dermee.dz/ | head -1                      # 200, served by the new app
curl -s  https://dermee.dz/ | grep -o '<html[^>]*>'         # lang/dir attributes of the new app
curl -s  https://dermee.dz/api/v1/health                    # {"status":"ok","db":"up",...}
curl -s  https://dermee.dz/health                           # legacy path still works
curl -sI https://dermee.dz/doctors | head -1                # 200 from the web app (R1)
curl -sI https://dermee.dz/api | head -1                    # Swagger still served
curl -s  "https://dermee.dz/api/v1/socket.io/?EIO=4&transport=polling" | head -c 80   # Socket.IO handshake
docker ps --format '{{.Names}} {{.Status}}'                 # api/postgres uptime unchanged since step 1
```

In the browser, check:
- Sign in as admin, patient and doctor.
- Refresh deep links (`/admin/reservations`, `/patient/orders`).
- Google sign-in comes back to `/auth/callback`.
- Upload a document.
- See a live notification.
- Switch to Arabic and check the layout mirrors.

## 11. Risks and separate concerns

1. **Schema migrations in production (§7).** This is the riskiest step and the only one that can't be undone without restoring a backup.
2. **Uploaded files** currently live inside the `dermee-api` container layer. Any API recreate, including the one in §7, deletes them unless they are copied out first (§9 E).
3. **Other API clients** on `dermee.dz/doctor` or `/auth/*` (§5 R1).
4. **Postgres is published on `0.0.0.0:5432`.** If `ufw` doesn't block it, the database is reachable from the internet with a password only. I'm not changing it as part of this task; I recommend binding it to `127.0.0.1` or blocking 5432 in the firewall as a separate, approved change.
5. **Port 3000 is also published on `0.0.0.0`,** so the API is reachable over plain HTTP, bypassing Nginx. That's the same remark as for 5432, also not changed here.
6. **Tokens in `localStorage`** mean an XSS bug would expose them. The app renders no user HTML, and React escapes output. This is a known trade-off of the backend's Bearer design and doesn't change in this task.

## 12. Decisions I need from you

1. **Routing:** R1 (recommended), R2 or R3 (§5). Also: does any client other than the old landing page call `dermee.dz/doctor/...` or `dermee.dz/auth/...`?
2. **Backend upgrade with migrations:** approve the separate §7 step, with backups, before the web cut-over.
3. **CD path:** paste the §9 output. If it confirms build-on-VPS (§6.2), do you want me to also make the Jenkins flow work for both repos (§6.3), or stay with build-on-VPS?
