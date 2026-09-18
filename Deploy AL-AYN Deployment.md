# AL-AYN — Deployment Guide

> For the engineer doing the deploy + the Claude Code session helping them.
> Last updated: 2026-09-19. Tested against backend v2.1.0.

## 0. Current production (read this first)

**Live at https://al-ayn.srv1956050.hstgr.cloud** — Hostinger VPS (`ssh sinan-vps`), deployed 2026-09-19.
Frontend and API are on the **same origin**, which is simpler than the split
Hugging Face + GitHub Pages layout described in §2–§7 (kept as an alternative).

| What | Where |
|---|---|
| Code | `/opt/al-ayn/frontend` (static, served by nginx) and `/opt/al-ayn/backend` |
| API service | systemd `al-ayn` → Node on `127.0.0.1:7860` (`journalctl -u al-ayn -f`) |
| Secrets + DB URL | `/etc/al-ayn/al-ayn.env` (root:alayn 0640). Back up `PG_ENC_KEY` / `PHONE_HMAC_KEY` — never change them |
| Database | local Postgres, db `alayn_prod`, role `alayn_user`, `pgcrypto` enabled |
| nginx | `/etc/nginx/sites-available/al-ayn.conf` (from `deploy/nginx-al-ayn.conf`), Let's Encrypt cert auto-renews |
| Backups | `/etc/cron.daily/al-ayn-backup` → `/var/backups/al-ayn/*.dump` (7 days) — restore with `pg_restore` |
| Telegram | disabled (`TELEGRAM_BOT_TOKEN` empty). To enable: put the token in the env file, `systemctl restart al-ayn`, and stop any old Hugging Face copy polling the same bot |

**Redeploy after changing code** (from the repo root on the Mac, after committing):

```bash
bash deploy/deploy.sh      # copies files, npm ci, restarts, prints /health
```

Bump the `?v=NN` numbers in `index.html` whenever JS/CSS changes (static files are cached 7 days).

**Superadmins**: created with `deploy/bootstrap-superadmin.sh` from the `SUPERADMIN_*` values in the
env file (PIN lines are blanked afterwards). To reset a forgotten superadmin password: put the phone and
a new PIN back into the env file, run `ssh sinan-vps bash /opt/al-ayn/deploy/bootstrap-superadmin.sh`,
then blank the PIN line again.

**Fresh server from scratch**: `bash deploy/deploy.sh`, then `ssh sinan-vps bash /opt/al-ayn/deploy/setup-server.sh`.

---

This document tells you everything you need to put AL-AYN online safely. Read all of it before starting — it's short for a reason, every section matters.

---

## 1. What AL-AYN is

A Progressive Web App (Arabic, RTL) for tracking monthly orphan-sponsorship donations across multiple campaign "groups" (each group is its own campaign/university).

**Roles**: `superadmin` (platform-wide), `admin` (one group), `collector` (collects payments from a subset of donors), `donor`.

---

## 2. Architecture

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│  FRONTEND (static)              │         │  BACKEND (Docker on HF Space)    │
│  index.html, js/, css/          │ ──XHR── │  Node 18 + Express, port 7860    │
│  Served by: GitHub Pages,       │         │                                  │
│  Netlify, Cloudflare Pages,     │         │  Reads/writes ↓                  │
│  or any static host             │         └──────────────────────────────────┘
└─────────────────────────────────┘                            │
                                                               ↓
                                              ┌──────────────────────────────────┐
                                              │  POSTGRES 15+ (managed)          │
                                              │  Supabase / Neon / Railway / etc │
                                              │  Requires extension: pgcrypto    │
                                              └──────────────────────────────────┘
                                                               ↑
                                              Optional: Telegram bot polls the
                                              backend; bot token in env.
```

The backend **does not host the frontend**. They are two separate origins. This shapes most of what follows (CORS, cookies, API URL).

---

## 3. What you need to provision

| Thing | What | Notes |
|---|---|---|
| GitHub repo | Code lives here | Contains both frontend (repo root) and backend (`backend/`) |
| Hugging Face Space | Backend host | Docker SDK. Repo has `Dockerfile` + `README.md` with HF metadata |
| Static host | Frontend host | GitHub Pages is simplest (free, same repo). Cloudflare Pages also fine |
| Postgres database | Data | Managed PG 15+ with `pgcrypto`. Free tiers that work: **Neon**, **Supabase**, **Railway** (trial), **Render**. Avoid SQLite, MySQL — schema uses Postgres-specific features (`pgp_sym_encrypt`, `INET`, `BIGSERIAL`, `JSONB`) |
| Telegram bot (optional) | Reminders + receipts | Create with @BotFather. Token goes in env |

You do **not** need a domain to ship. HF Space + GitHub Pages give you `*.hf.space` and `*.github.io` URLs that work end-to-end. A custom domain is a future step.

---

## 4. Generating secrets (do this once, save them somewhere safe)

```bash
# 48-byte JWT secret (token signing)
openssl rand -hex 48        # → JWT_SECRET

# 32-byte PG encryption key (orphan PII column encryption)
openssl rand -hex 32        # → PG_ENC_KEY

# 32-byte phone HMAC key (lookups without storing plaintext phones)
openssl rand -hex 32        # → PHONE_HMAC_KEY

# 32-byte API secret (general-purpose)
openssl rand -hex 32        # → API_SECRET
```

⚠ **`PG_ENC_KEY` and `PHONE_HMAC_KEY` must never change after first use.** Rotating them invalidates every existing encrypted orphan record and every phone-hash login lookup. Treat them like database keys, not application secrets.

---

## 5. Provision the database

1. Create a PG 15+ database with your managed provider.
2. Get the connection URL — should look like:
   ```
   postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
   ```
3. Most managed providers require SSL — set `DB_SSL=true` in env (see §7).
4. Enable the `pgcrypto` extension. The first migration does `CREATE EXTENSION IF NOT EXISTS pgcrypto;` so this is automatic on first boot — but on Supabase you may need to enable it from the dashboard (Database → Extensions → enable `pgcrypto`).

Migrations run automatically every time the backend starts. They live in `backend/sql/migrations/` and are tracked in the `schema_migrations` table. **You do not run them manually.**

---

## 6. Deploy the backend to Hugging Face Spaces

### 6a. Create the Space

1. On huggingface.co → New Space → SDK: **Docker** → Public or Private (your call).
2. Set the Space repo URL — clone it locally OR add it as a git remote on the AL-AYN repo:
   ```bash
   git remote add hf https://huggingface.co/spaces/<YOUR-USER>/<YOUR-SPACE>
   git push hf main
   ```
3. The Space will build the `Dockerfile` automatically and listen on port 7860.

### 6b. Set the environment variables on the Space

Go to the Space → Settings → "Variables and secrets" → add as **secrets**:

```env
NODE_ENV=production
PORT=7860

# ── Database ──────────────────────────────────
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
DB_SSL=true                       # set to 'false' only if your PG host doesn't require SSL

# ── Cryptographic secrets (from §4, never change after first boot) ──
JWT_SECRET=<openssl rand -hex 48>
PG_ENC_KEY=<openssl rand -hex 32>
PHONE_HMAC_KEY=<openssl rand -hex 32>
API_SECRET=<openssl rand -hex 32>

# ── Cookies (cross-origin deployment) ─────────
COOKIE_SECURE=true                # MUST be true; HF Space serves over HTTPS
COOKIE_SAMESITE=None              # MUST be None when frontend is on a DIFFERENT host
                                  # (e.g. github.io). For same-origin deploys, omit or use 'Strict'.

# ── CORS — must list every frontend origin that talks to this backend ──
CORS_ORIGIN=https://<YOUR-GITHUB-USER>.github.io

# Multiple origins are comma-separated, no spaces:
# CORS_ORIGIN=https://yoursite.github.io,https://yourdomain.com

# ── Superadmin accounts (bootstrap; up to 2) ──
SUPERADMIN_PHONE_1=+9647XXXXXXXXX
SUPERADMIN_PIN_1=A1234567*@p53        # strong password (any string ≥ 4 chars, ≤ 20)
SUPERADMIN_NAME_1=مدير التطبيق

SUPERADMIN_PHONE_2=+9647YYYYYYYYY     # optional — leave blank to skip
SUPERADMIN_PIN_2=A1234567*@p53
SUPERADMIN_NAME_2=مدير التطبيق 2

# ── Telegram bot (optional but recommended) ───
TELEGRAM_BOT_TOKEN=<token from @BotFather>
```

### 6c. Bootstrap the superadmin(s)

Migrations run on every boot, but the superadmin script does not — you run it once.

**Option A — from your local machine pointed at the production DB:**
```bash
cd backend
# Temporarily put the production DATABASE_URL + superadmin env vars in backend/.env
node scripts/bootstrap-superadmin.js
# Remove the file or revert .env afterwards — never commit it.
```

**Option B — using HF Space's "Logs" / a Space restart trick:** add a one-shot job. Easier to use option A.

The script is idempotent: re-running it updates the PIN/name. Useful if you forget the password.

### 6d. Verify the backend

```bash
curl https://<YOUR-SPACE>.hf.space/health
# Expect: {"status":"ok","version":"2.0.0","uptime":<n>}
```

If you see the JSON, the backend is up, migrations ran, and PG is reachable. If you see a 500 or HTML, open Space → Logs and look for `[FATAL]` or `Migration … failed`.

---

## 7. Deploy the frontend

### 7a. Point the frontend at the backend

Open `index.html`. Around line 99 there's a small script:

```html
<script>
  (function () {
    var h = location.hostname;
    var p = location.port;
    var isLocal = h === 'localhost' || h === '127.0.0.1';
    window.AL_AYN_API = (isLocal && p && p !== '7860') ? 'http://localhost:7860' : '';
  })();
</script>
```

For **production split-hosting** (frontend on GitHub Pages, backend on HF Space) you MUST set the production URL. Change the line to:

```js
window.AL_AYN_API = isLocal
  ? ((p && p !== '7860') ? 'http://localhost:7860' : '')
  : 'https://<YOUR-SPACE>.hf.space';   // ← your HF Space URL, no trailing slash
```

> If you ever serve the frontend from the same origin as the backend (i.e. you make the backend serve static files too), leave `AL_AYN_API` empty (`''`) — that means "same origin." That's not the default deployment.

### 7b. Publish to GitHub Pages

1. GitHub repo → Settings → Pages → Source: "Deploy from a branch" → branch `main`, folder `/ (root)`.
2. Wait ~1 min for build. Your URL will be `https://<USER>.github.io/<REPO>/`.
3. Add that URL to `CORS_ORIGIN` on the HF Space (see §6b). Restart the Space after changing env.

### 7c. Verify the frontend

1. Open the GitHub Pages URL.
2. Open DevTools → Network tab.
3. Click تسجيل الدخول (Login). Enter a superadmin phone (e.g. `07XXXXXXXXX`).
4. The POST to `/api/auth/login` should hit `https://<YOUR-SPACE>.hf.space/api/auth/login` and return `{"success":true,"require_pin":true}`.
5. Enter the password → you should land on the home screen.

If the request hits the wrong host: §7a was skipped — re-check `window.AL_AYN_API`.
If you see CORS errors in Console: the GitHub Pages URL isn't in `CORS_ORIGIN` on the Space — fix and restart.
If you see "ERR_BLOCKED_BY_RESPONSE" or cookies aren't sticking: `COOKIE_SECURE` or `COOKIE_SAMESITE` is wrong (must be `true` / `None` for cross-origin).

---

## 8. Post-deploy checks

Run all of these. Each one verifies a security control.

```bash
# 1. Health
curl -s https://<SPACE>.hf.space/health

# 2. Anonymous read should be blocked (returns 401 or similar)
curl -s -i https://<SPACE>.hf.space/api/users | head -3

# 3. Phone validation rejects garbage (returns 400)
curl -s -X POST https://<SPACE>.hf.space/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"abc","pin":null}'

# 4. CORS rejects untrusted origins
curl -s -i -X POST https://<SPACE>.hf.space/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.example.com" \
  -d '{"phone":"+9647XXXXXXXXX","pin":null}' | grep -i "access-control\|cors\|blocked"

# 5. Confirm migrations actually applied (this should list ≥ 3 rows in the logs;
#    the easier check is just the Space logs showing "[MIGRATE] ✓ 000X_*.sql" on first boot)
```

Then in the browser:
- Log in as superadmin → create a test group → create a test donor → log out.
- Log back in as the donor → confirm they see ONLY their group (the IDOR controls).
- Log back in as superadmin → delete the test data.

---

## 9. Security model — what's in place

Do **not** weaken these without thinking carefully.

| Control | Where | Notes |
|---|---|---|
| JWT in `httpOnly` cookie + 15min expiry + rotating refresh tokens (30 days) | `routes/auth.js`, `sessions` table | Refresh hash is SHA-256'd in DB. |
| bcrypt cost 12 on all PINs | `auth.js`, `users.js` | Any string 4–20 chars accepted; superadmin uses a long password. |
| Account lockout after 5 failed PINs for 15 min | `auth.js` | Per-user, in DB. |
| Rate limit: login 5/15min in production, 100/min in dev | `middleware/rateLimit.js` | Triggered by `NODE_ENV`. |
| CSRF: double-submit cookie (`alayn_csrf`); state-changing requests need `X-CSRF-Token` header equal to cookie | `middleware/csrf.js` | Public auth endpoints (`/login`, `/register-donor`, `/refresh`) are exempt. |
| CORS allowlist (no wildcard reflection) with `credentials: true` | `app.js` | Env-driven `CORS_ORIGIN`. |
| Helmet security headers | `app.js` | CSP intentionally disabled because the frontend uses inline `onclick=` handlers; XSS is mitigated by per-field escaping (see below). |
| Cross-group authorization (IDOR protection) on every list/read/write route | `routes/users.js, orphans.js, donations.js, announcements.js, payReports.js` | Uses `assertGroup()` / `effectiveGroupId()` helpers in `middleware/auth.js`. Superadmins are global; everyone else is pinned to `req.user.groupId`. |
| Privilege protections in `users.js` DELETE / PUT / POST | `routes/users.js` | Admin cannot create another admin, edit/delete an admin or superadmin, or delete cross-group. Superadmin cannot self-delete. |
| Stored XSS sinks escaped via `App.esc()` | `js/app.js` (~60 sinks) | Names / titles / content / notes / locations all pass through textContent-based escaping before being interpolated into innerHTML templates. |
| Telegram link codes use `crypto.randomBytes` (Crockford base32, ~50 bits) | `routes/telegram.js` | Replaces a previous `Math.random()` implementation. |
| Orphan PII (name, birth_date, notes) encrypted at rest with `pgp_sym_encrypt` | `0001_init.sql`, `routes/orphans.js` | Key is `PG_ENC_KEY`. **Cannot be rotated** without re-encrypting all rows. |
| Phone numbers stored as `phone_hash` (HMAC-SHA-256) for lookup; plaintext kept separately | `services/phone.js` | Allows login-by-phone without indexable plaintext. |
| Telegram bot tokens encrypted per-group | `groups.telegram_bot_token_enc` (BYTEA) | Same `PG_ENC_KEY`. Not exposed via API. |

---

## 10. Operational scripts

All live in `backend/scripts/`. Run from the `backend/` directory after setting `backend/.env` to point at the target database.

```bash
node scripts/bootstrap-superadmin.js   # Create/update superadmin(s) from env. Idempotent.

node scripts/wipe-data.js --dry-run    # Preview row counts in all tables.
node scripts/wipe-data.js --yes        # Empty data tables; keep schema + superadmins + settings.
node scripts/wipe-data.js --yes --all-users    # Factory reset (also deletes superadmins).

node scripts/import-from-export.js path/to/snapshot.json   # One-time migration from localStorage exports.
```

`wipe-data` requires `--yes` so it cannot fire by accident. Use it once after the initial deploy if any test data has crept in.

---

## 11. Things that will go wrong — fix recipes

### "Login button does nothing in the browser"
- Open DevTools → Network. Look at the POST to `/api/auth/login`.
- **501 Unsupported method** → frontend is hitting the static host, not the backend. Fix `window.AL_AYN_API` in §7a.
- **CORS errors** → the frontend origin is missing from `CORS_ORIGIN` env on the Space. Add and restart.
- **400 Bad Request** with `phone: ...` → phone format is invalid; must be Iraqi (+964 + 7XXXXXXXXX) or a number `libphonenumber-js` accepts.
- **403 invalid CSRF token** → only happens if you've changed the CSRF middleware mount; should not occur on a fresh deploy.
- **Cookies not sticking** → `COOKIE_SAMESITE` must be `None` for cross-origin deploys, and `COOKIE_SECURE` must be `true` (HTTPS only). Browsers silently drop `SameSite=None` cookies without `Secure`.

### "Backend won't start" (Space stuck on building / error log)
Check Space logs for:
- `Migration 000X failed: relation … does not exist` → DB user lacks permission, or you're pointed at the wrong database.
- `Connection terminated unexpectedly` → DATABASE_URL is wrong or DB host is unreachable from HF.
- `[FATAL] PG_ENC_KEY` or similar → required env var is unset.

### "I locked myself out as superadmin"
Run `node scripts/bootstrap-superadmin.js` against the production DB with new PIN values in `.env`. The script updates `pin_hash` if the phone already exists.

### "I need to wipe all the test data before going live"
Run `npm run wipe` from `backend/` (preserves superadmins). Then **also** tell anyone who has used the app to clear their browser localStorage — the PWA caches data locally:

```js
// Paste in browser DevTools console:
Object.keys(localStorage).filter(k => k.startsWith('alayn_')).forEach(k => localStorage.removeItem(k));
location.reload();
```

### "The Telegram bot isn't sending messages"
- `TELEGRAM_BOT_TOKEN` env var must be set and the bot must be enabled with @BotFather.
- HF Space free tier sleeps after inactivity; the bot polling will stop. Either upgrade or accept the gap.
- Per-group bots (if used): tokens live encrypted in `groups.telegram_bot_token_enc`. Set via admin UI, not env.

### "How do I update the deployed code?"
```bash
git push origin main      # static frontend → auto-deploys via GitHub Pages
git push hf main          # backend → HF rebuilds the Docker image
```
Both happen in parallel. The backend rebuild takes 2–4 minutes.

If you change JS files, bump the `?v=NN` query string in `index.html` so browsers don't serve a stale cached bundle.

---

## 12. What to NOT do

- Do not commit `backend/.env`. The repo's `.env.example` is the template; `.env` is gitignored.
- Do not rotate `PG_ENC_KEY` or `PHONE_HMAC_KEY` after the first boot. They are not application secrets — they are part of the data.
- Do not set `CORS_ORIGIN=*`. The codebase reflects only explicitly-listed origins; a wildcard would break `credentials: true` anyway.
- Do not run `wipe-data.js --all-users` on a live deployment unless you understand it deletes superadmins.
- Do not weaken the cookie flags. `COOKIE_SECURE=false` is only acceptable for local dev over plain HTTP. In production both `Secure` and `SameSite` must be set correctly for the origin layout.
- Do not host the frontend over plain HTTP in production. Cookies with `Secure` will not be sent, and login will silently fail.

---

## 13. Reference — every env var

| Var | Required? | Example | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Toggles rate-limit strictness. |
| `PORT` | no | `7860` | HF Space requires 7860; leave as default. |
| `DATABASE_URL` | yes | `postgres://u:p@h:5432/db?sslmode=require` | Postgres 15+. |
| `DB_SSL` | yes for managed PG | `true` | Set `false` only if your provider doesn't use TLS. |
| `JWT_SECRET` | yes | 96-char hex | `openssl rand -hex 48`. |
| `PG_ENC_KEY` | yes | 64-char hex | `openssl rand -hex 32`. **Immutable.** |
| `PHONE_HMAC_KEY` | yes | 64-char hex | `openssl rand -hex 32`. **Immutable.** |
| `API_SECRET` | yes | 64-char hex | `openssl rand -hex 32`. |
| `COOKIE_SECURE` | yes | `true` in prod | Must be true over HTTPS. |
| `COOKIE_SAMESITE` | yes for cross-origin | `None` | Defaults to `Strict`. Set to `None` only if frontend ≠ backend origin. Requires `COOKIE_SECURE=true`. |
| `CORS_ORIGIN` | yes | `https://you.github.io` | Comma-separated list of allowed frontend origins. No wildcards. |
| `TELEGRAM_BOT_TOKEN` | optional | from @BotFather | Default platform bot. |
| `SUPERADMIN_PHONE_1` | yes (first boot) | `+9647XXXXXXXXX` | E.164. |
| `SUPERADMIN_PIN_1` | yes (first boot) | `A1234567*@p53` | Any string 4–20 chars. |
| `SUPERADMIN_NAME_1` | no | `مدير التطبيق` | Optional display name. |
| `SUPERADMIN_PHONE_2` / `_PIN_2` / `_NAME_2` | no | — | Optional second superadmin. |

---

## 14. Pre-flight checklist

Tick all of these before announcing the app is live:

- [ ] Postgres provisioned, `pgcrypto` extension confirmed enabled
- [ ] All required env vars set on the HF Space (every row in §13 marked "yes")
- [ ] HF Space build succeeded, `/health` returns 200
- [ ] Migrations applied (check Space logs for `[MIGRATE] ✓ 0001_init.sql`, `0002_indexes.sql`, `0003_audit_revoke.sql`)
- [ ] `bootstrap-superadmin.js` has been run once; you can log in
- [ ] `index.html` line 109 has been updated to point at the HF Space URL
- [ ] Frontend deployed to GitHub Pages (or chosen static host)
- [ ] GitHub Pages URL is in `CORS_ORIGIN` on the Space; Space restarted afterwards
- [ ] `COOKIE_SECURE=true`, `COOKIE_SAMESITE=None` for cross-origin deploys
- [ ] Login works end-to-end from the production frontend URL
- [ ] Test donor account can only see its own group's data (IDOR check)
- [ ] Test data wiped before announcing (§11 "I need to wipe all the test data")
- [ ] Secrets backed up in a password manager (every key in §4)

---

## 15. For Claude Code helping with this deploy

A few things to keep in mind as you assist:

- The deployer's most likely first failure is "login doesn't work" — 80% of the time it's `window.AL_AYN_API` not pointing at the backend, `CORS_ORIGIN` missing the frontend, or `COOKIE_SAMESITE` left as `Strict` for a cross-origin deploy. Check Network tab status codes before guessing.
- Migrations run automatically on `node server.js`. Do not invent a separate "run migrations" command — there isn't one.
- The Postgres encryption keys (`PG_ENC_KEY`, `PHONE_HMAC_KEY`) cannot be rotated. If the deployer asks "should we change these to be more secure?", the answer is no — generate them once, save them in a password manager, never touch them again.
- The rate limit in production is strict (5 login attempts per 15min per phone+IP). When debugging, restart the backend to clear it — there's no API to flush it.
- The frontend caches data in localStorage. After any database wipe, tell the user to also clear their browser cache (§11).
- The codebase has no test suite. Verification is by curl + browser DevTools (§8).
- The frontend uses inline `onclick=` extensively, which is why CSP is disabled. Do not try to enable a strict CSP without a substantial refactor of `js/app.js`.
- The bot service in `services/telegramBot.js` polls Telegram. If you see "polling error" in logs and the token is correct, it's usually two instances polling the same bot — check that only one container is running.

Recommended first action when invoked by the deployer: run `git status` and `git log --oneline -5`, then ask which step of this guide they're stuck on. Don't start running deployment commands without that context — the environment is split across three providers and you need to know which one.
