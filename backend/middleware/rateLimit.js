const rateLimit = require('express-rate-limit');

function makeLimit(max, windowMinutes, keyFn) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFn || ((req) => req.ip),
    handler: (req, res) =>
      res.status(429).json({ success: false, error: 'Too many requests, try again later.' }),
  });
}

const isDev = process.env.NODE_ENV !== 'production';
const loginLimiter = makeLimit(isDev ? 100 : 5, isDev ? 1 : 15, (req) =>
  `${req.body?.phone || ''}::${req.ip}`
);

const registerDonorLimiter = makeLimit(3, 60);

const generalApiLimiter = makeLimit(60, 1, (req) =>
  req.user?.sub || req.ip
);

const announcementLimiter = makeLimit(5, 1, (req) => req.user?.sub || req.ip);

const donationLimiter = makeLimit(60, 1, (req) => req.user?.sub || req.ip);

const supportMsgLimiter = makeLimit(5, 60, (req) => req.user?.sub || req.ip);

const telegramLimiter = makeLimit(10, 1, (req) =>
  req.user?.groupId || req.ip
);

module.exports = {
  loginLimiter,
  registerDonorLimiter,
  generalApiLimiter,
  announcementLimiter,
  donationLimiter,
  supportMsgLimiter,
  telegramLimiter,
};
