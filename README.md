# ومن أحياها — Waman Ahyaha

Monthly orphan-sponsorship tracker for university campaigns (Arabic, RTL PWA).
Donors pledge a monthly amount, collectors confirm cash payments in a month grid,
admins run their campaign, and a superadmin oversees every campaign.

- **Live:** https://waman-ahyaha.srv1956050.hstgr.cloud
- **Frontend:** static files at the repo root (`index.html`, `js/`, `css/`) — no build step
- **Backend:** `backend/` — Node 22, Express 5, PostgreSQL (migrations run on boot)
- **Deploy / operate:** see [DEPLOYMENT.md](DEPLOYMENT.md) (`bash deploy/deploy.sh`)
- **Mobile app (iOS + Android):** [`mobile/`](mobile/README.md). Expo / React Native on the same backend; store
  steps in [mobile/SUBMISSION_GUIDE.md](mobile/SUBMISSION_GUIDE.md)

## Run locally

```bash
cd backend && npm ci
cp .env.example .env        # set DATABASE_URL, secrets, COOKIE_SECURE=false, HOST=0.0.0.0
node server.js              # API on :7860, runs migrations
node scripts/bootstrap-superadmin.js
# serve the repo root on any static server and open it (index.html points local ports at :7860)
```
