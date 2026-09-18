const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const csrf         = require('./middleware/csrf');
const { errorHandler, notFound } = require('./middleware/errors');
const { generalApiLimiter }      = require('./middleware/rateLimit');

const authRoutes          = require('./routes/auth');
const usersRoutes         = require('./routes/users');
const groupsRoutes        = require('./routes/groups');
const donationsRoutes     = require('./routes/donations');
const announcementsRoutes = require('./routes/announcements');
const orphansRoutes       = require('./routes/orphans');
const campaignReqRoutes   = require('./routes/campaignRequests');
const supportMsgRoutes    = require('./routes/supportMessages');
const payReportsRoutes    = require('./routes/payReports');
const auditLogsRoutes     = require('./routes/auditLogs');
const leaderboardRoutes   = require('./routes/leaderboard');
const exportImportRoutes  = require('./routes/exportImport');
const telegramRoutes      = require('./routes/telegram');

const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5500,http://localhost:8080,http://127.0.0.1:5500')
  .split(',').map(s => s.trim());

const app = express();

// ── Security headers ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // frontend sets its own CSP
}));

// ── CORS ──────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
    console.warn(`[CORS] Blocked: ${origin}`);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// ── Body / cookies ────────────────────────────────────────
app.use('/api/import', express.json({ limit: '50mb' }));
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());

// ── Trust proxy (Nginx sets X-Forwarded-For) ─────────────
app.set('trust proxy', 1);

// ── CSRF ──────────────────────────────────────────────────
app.use('/api', csrf);

// ── General rate limit ────────────────────────────────────
app.use('/api', generalApiLimiter);

// ── Export rate limit: 5/day per superadmin (full exports only) ───
const exportLimiter = rateLimit({
  windowMs: 24 * 3600 * 1000, max: 5,
  keyGenerator: req => req.user?.sub || req.ip,
  handler: (req, res) => res.status(429).json({ success: false, error: 'export limited to 5 times per day' }),
  skip: req => req.path !== '/' && req.path !== '',
});
app.use('/api/export', exportLimiter);

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth',             authRoutes);
app.use('/api/users',            usersRoutes);
app.use('/api/groups',           groupsRoutes);
app.use('/api/donations',        donationsRoutes);
app.use('/api/announcements',    announcementsRoutes);
app.use('/api/orphans',          orphansRoutes);
app.use('/api/campaign-requests', campaignReqRoutes);
app.use('/api/support-messages', supportMsgRoutes);
app.use('/api/pay-reports',      payReportsRoutes);
app.use('/api/audit-logs',       auditLogsRoutes);
app.use('/api/leaderboard',      leaderboardRoutes);
app.use('/api/export',           exportImportRoutes);
app.use('/api/import',           exportImportRoutes);
app.use('/api',                  telegramRoutes); // auth-code, check-auth, send-reminders, etc.

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0.0', uptime: process.uptime() }));

// ── Error handling ────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
