const rateLimit = require('express-rate-limit');
const jwt       = require('jsonwebtoken');

// Limiters mostly run before authRequired, so req.user isn't set yet. Key on the
// user from a valid access cookie when there is one, otherwise on the client IP.
// (Keying everyone on IP made a whole campus Wi-Fi share one budget.)
function userOrIp(req) {
  const h = req.headers.authorization || '';
  const t = req.cookies?.waman_at || (h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  if (t) { try { return 'u:' + jwt.verify(t, process.env.JWT_SECRET).sub; } catch {} }
  return 'ip:' + req.ip;
}

function makeLimit(max, windowMinutes, keyFn) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFn || userOrIp,
    handler: (req, res) =>
      res.status(429).json({ success: false, error: 'Too many requests, try again later.' }),
  });
}

const isDev = process.env.NODE_ENV !== 'production';
const loginLimiter = makeLimit(isDev ? 100 : 5, isDev ? 1 : 15, (req) =>
  `${req.body?.phone || ''}::${req.ip}`
);

// Public self-registration only (staff add donors through POST /api/users/donors).
const registerDonorLimiter = makeLimit(isDev ? 100 : 20, 60, (req) => req.ip);

const generalApiLimiter = makeLimit(300, 1);

const announcementLimiter = makeLimit(5, 1);

const donationLimiter = makeLimit(120, 1);

// Visitor-facing writes: support messages, new-campaign requests.
const supportMsgLimiter = makeLimit(5, 60);

const telegramLimiter = makeLimit(10, 1, (req) =>
  req.user?.groupId || userOrIp(req)
);

module.exports = {
  userOrIp,
  loginLimiter,
  registerDonorLimiter,
  generalApiLimiter,
  announcementLimiter,
  donationLimiter,
  supportMsgLimiter,
  telegramLimiter,
};
