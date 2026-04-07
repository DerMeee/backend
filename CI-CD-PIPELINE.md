# DerMeee backend — CI/CD pipeline guide

This document describes the end-to-end pipeline (GitHub → Jenkins → GHCR → Ansible → Docker on the VPS), common failure modes we hit, and how to reuse these patterns on future projects.

---

## 1. Architecture overview

```
Developer pushes / merges to GitHub (main)
        │
        ├─► GitHub Actions (.github/workflows/ci.yml) — optional CI:
        │     install, lint, format check, build (no deploy)
        │
        ├─► GitHub Webhook → VPS:
        │     Nginx :80 / :443 → /github-webhook/ → Jenkins :8080
        │
        └─► Jenkins Pipeline (Jenkinsfile)
              1. git checkout
              2. docker login (GHCR) via Jenkins credentials
              3. docker build + docker push
                 → ghcr.io/<namespace>/dermeee-api:<git-short-sha> + :latest
              4. (main/master only) Ansible over SSH:
                   updates API_IMAGE_TAG on the server, docker compose pull + up
```

**On the VPS**, Docker Compose (see `deploy/docker-compose.prod.yml`) runs:

- **Postgres** — official image `postgres:14-alpine` (no custom image to build)
- **API** — your built image from GHCR
- **Frontend** — separate image `dermeee-frontend` (often built from another repo)

**Nginx** (`nginx/dermee.conf`) serves the public site and proxies **`/github-webhook/`** to Jenkins so GitHub does not need direct access to port **8080**.

---

## 2. Setup from scratch (checklist)

1. **Dockerize the API** — `Dockerfile` at repo root; production compose under `deploy/docker-compose.prod.yml` using `${DOCKER_REGISTRY}/dermeee-api:${API_IMAGE_TAG}`.
2. **Container registry** — e.g. GHCR. Set **`DOCKER_REGISTRY=ghcr.io/<user-or-org>`** (shared prefix for all images; image name + tag are separate).
3. **VPS** — Docker installed; **`/opt/dermeee/.env`** from `deploy/env.server.example` (secrets, `API_PORT`, `FRONTEND_PORT`, tags, Postgres, JWT, `ALLOWED_ORIGINS`, OAuth if used).
4. **Ansible** — `deploy/ansible/playbooks/deploy.yml` copies compose, sets `API_IMAGE_TAG`, runs compose. Use committed **`inventory/jenkins.ini`** when Jenkins runs on the same host as production (localhost + deploy user); use gitignored **`hosts.ini`** for remote IPs.
5. **Jenkins** — Install Java 21+ then Jenkins (official key `jenkins.io-2026.key`). User **`jenkins`** in group **`docker`**. Credentials:
   - **`docker-registry-credentials`** — Username + password (GitHub username + PAT with `write:packages`).
   - **`vps-ssh-deploy-key`** — SSH private key whose public key is in `deploy`’s `authorized_keys` on the target host.
6. **Global env** — **Manage Jenkins → System → Global properties → Environment variables**: `DOCKER_REGISTRY` (optional if `Jenkinsfile` defines a fallback).
7. **Pipeline job** — **Pipeline script from SCM** (not an inline script in the UI): Git URL, branch, **Script Path: `Jenkinsfile`**.
8. **Webhook** — GitHub repo → Settings → Webhooks: Payload URL **`http(s)://<your-domain>/github-webhook/`** (no `:8080` if Nginx proxies). On the job: enable **GitHub hook trigger for GITScm polling**.

---

## 3. Environment variables (what goes where)

| Where | Purpose |
|-------|--------|
| `backend/.env` (local, gitignored) | Local dev: `DATABASE_URL`, JWT, OAuth, etc. |
| `/opt/dermeee/.env` on VPS | Production compose: `DOCKER_REGISTRY`, `API_IMAGE_TAG`, `FRONTEND_IMAGE_TAG`, Postgres, secrets, ports, `ALLOWED_ORIGINS`. |
| Jenkins **Credentials** | Registry user/PAT; SSH key — **not** `REG_USER`/`REG_PASS` in any `.env` file. Those names are injected only inside `withCredentials` in the pipeline. |

**`API_IMAGE_TAG` / `FRONTEND_IMAGE_TAG`** — whatever tag you pushed (`latest`, `test1`, or the Jenkins git short SHA). Ansible/Jenkins updates `API_IMAGE_TAG` on deploy.

---

## 4. Challenges encountered and fixes

| Symptom | Cause | Fix |
|---------|--------|-----|
| `usermod: user 'jenkins' does not exist` | Jenkins not installed (or bad apt install) | Install Jenkins with current repo key (`jenkins.io-2026.key`, `signed-by` in `sources.list`). |
| apt `NO_PUBKEY` / unsigned repository | Old/wrong Jenkins signing key | Use official steps: key in `/etc/apt/keyrings/jenkins-keyring.asc`, `deb [signed-by=...] https://pkg.jenkins.io/debian-stable binary/`. |
| `Set Jenkins job environment variable DOCKER_REGISTRY` | Empty registry in env | Set **Global properties** in Jenkins and/or use **fallback** in `Jenkinsfile`. |
| `Could not find credentials entry with ID 'docker-registry-credentials'` | Missing credential | Add **Username with password**, ID **exactly** `docker-registry-credentials`. |
| Confusion about `REG_USER` / `REG_PASS` | Assumed they belong in `.env` | They are **only** injected by Jenkins `withCredentials` — never commit them. |
| Stages “skipped due to earlier failure(s)” | Earlier stage failed | Scroll **up** in Console Output; fix the **first** `ERROR` (often Docker login). |
| Ansible inventory missing in workspace | `hosts.ini` gitignored | **Committed** `inventory/jenkins.ini` and pointed `ansible-playbook -i` at it. |
| `UNREACHABLE` to `203.0.113.50` | Example IP left in inventory | Use real VPS IP or `127.0.0.1` + `ansible_connection=local` when Jenkins and app share one VPS. |
| Webhook “failed to connect” | GitHub cannot reach `:8080` | Open firewall + cloud security group **or** proxy `/github-webhook/` on **80/443** via Nginx. |
| Wrong webhook URL | Path was `/` not `/github-webhook/` | Payload URL must end with **`/github-webhook/`**. |
| `308` on webhook | HTTP redirect (slash / HTTPS) | Nginx: **`location = /github-webhook`** + **`location /github-webhook/`**, `proxy_redirect off`; use URL that does not redirect POST. |
| `400 Hook should contain event type` | Test `curl` without GitHub headers | Expected for fake bodies; real GitHub sends `X-GitHub-Event`. |
| `200` on webhook delivery | — | Jenkins accepted the hook; confirm a **new build** runs. |

---

## 5. Operations quick reference

**Verify Jenkins build**

- Job → **Build Now** or merge to **main** → **Console Output** → **SUCCESS**.

**Verify VPS**

```bash
docker ps
curl -sS http://127.0.0.1:3000/health
grep API_IMAGE_TAG /opt/dermeee/.env
```

**Verify webhook**

- GitHub → Webhooks → **Recent deliveries** → **200** for push events.

---

## 6. Reuse on future projects

1. Keep **pipeline definition in Git** (`Jenkinsfile` or GitHub Actions YAML).
2. **Secrets only in CI** (Jenkins Credentials, GitHub Secrets) — never in the repo.
3. Use **stable credential IDs** in the pipeline and document them in a short comment at the top of the pipeline file.
4. **Split build/push** (registry) from **deploy** (SSH/Ansible/Kubernetes) so each can change independently.
5. **Inventory / targets**: commit non-secret examples; keep production secrets in **server env** only.
6. **Webhooks**: public URL, correct path, **no redirects** on POST; validate with **real** GitHub deliveries.
7. **Firewalls**: configure **both** OS firewall (e.g. `ufw`) and **cloud** security groups.
8. **Debugging**: the **first** red error in the log is the one that matters; later stages are often skipped as a consequence.

---

## 7. Related files in this repo

| File | Role |
|------|------|
| `Jenkinsfile` | Build/push API image + Ansible deploy on main/master |
| `.github/workflows/ci.yml` | Lint + build on push/PR |
| `deploy/docker-compose.prod.yml` | Production stack definition |
| `deploy/ansible/playbooks/deploy.yml` | Deploy playbook |
| `deploy/ansible/inventory/jenkins.ini` | Inventory when Jenkins runs on the same host as production |
| `nginx/dermee.conf` | App reverse proxy + `/github-webhook/` → Jenkins |
| `deploy/env.server.example` | Template for `/opt/dermeee/.env` |
