const { randomBytes } = require('crypto');

const COOKIE = 'alayn_csrf';
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

  // Skip CSRF for unauthenticated public endpoints.
  // Use originalUrl (without query) because this middleware is mounted at /api,
  // so req.path is stripped of the /api prefix.
  const PUBLIC = ['/api/auth/login', '/api/auth/register-donor', '/api/auth/refresh'];
  const urlPath = (req.originalUrl || '').split('?')[0];
  if (PUBLIC.includes(urlPath)) return next();

  const token = req.headers[HEADER] || req.body?._csrf;
  if (!token || token !== req.cookies[COOKIE]) {
    return res.status(403).json({ success: false, error: 'invalid CSRF token' });
  }
  next();
}

module.exports = csrf;
