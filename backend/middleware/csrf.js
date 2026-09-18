const { randomBytes } = require('crypto');

const COOKIE = 'waman_csrf';
const HEADER  = 'x-csrf-token';
const SAFE    = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrf(req, res, next) {
  // Issue CSRF cookie if missing
  if (!req.cookies[COOKIE]) {
    const token = randomBytes(24).toString('hex');
    res.cookie(COOKIE, token, {
      httpOnly: false,
      sameSite: process.env.COOKIE_SAMESITE || 'Strict',
      secure: process.env.COOKIE_SECURE === 'true',
    });
    req.cookies[COOKIE] = token;
  }

  if (SAFE.has(req.method)) return next();

  // CSRF only matters when the browser attaches the session cookies by itself.
  // Requests without them (mobile app with a Bearer token, or anonymous) can't
  // ride anyone's session.
  if (!req.cookies.waman_at && !req.cookies.waman_rt) return next();

  // Skip CSRF for unauthenticated public endpoints.
  // Use originalUrl (without query) because this middleware is mounted at /api,
  // so req.path is stripped of the /api prefix.
  // Visitor-facing forms (support message, new-campaign request) are included: the
  // auth cookies are SameSite=Strict, so a cross-site post can't ride a session anyway.
  const PUBLIC = ['/api/auth/login', '/api/auth/register-donor', '/api/auth/refresh',
                  '/api/support-messages', '/api/campaign-requests'];
  const urlPath = (req.originalUrl || '').split('?')[0];
  if (req.method === 'POST' && PUBLIC.includes(urlPath)) return next();

  const token = req.headers[HEADER] || req.body?._csrf;
  if (!token || token !== req.cookies[COOKIE]) {
    return res.status(403).json({ success: false, error: 'invalid CSRF token' });
  }
  next();
}

module.exports = csrf;
