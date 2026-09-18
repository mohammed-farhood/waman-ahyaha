const jwt = require('jsonwebtoken');

// The web app authenticates with an httpOnly cookie; the mobile app sends
// `Authorization: Bearer <access token>` and `X-Client: mobile`.
function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
function accessToken(req) { return req.cookies?.waman_at || bearerToken(req); }
function isMobile(req) { return req.get('X-Client') === 'mobile'; }

function authRequired(req, res, next) {
  const token = accessToken(req);
  if (!token) return res.status(401).json({ success: false, error: 'unauthenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'token expired or invalid' });
  }
}

function roleRequired(...roles) {
  return [authRequired, (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    res.status(403).json({ success: false, error: 'forbidden' });
  }];
}

// Allow if same group OR has elevated role
function sameGroupOr(...elevatedRoles) {
  return [authRequired, (req, res, next) => {
    if (elevatedRoles.includes(req.user.role)) return next();
    const gid = req.params.groupId || req.query?.groupId || req.body?.groupId;
    if (gid && req.user.groupId === gid) return next();
    res.status(403).json({ success: false, error: 'forbidden' });
  }];
}

// Allow if acting on self OR has elevated role
function selfOr(...elevatedRoles) {
  return [authRequired, (req, res, next) => {
    if (elevatedRoles.includes(req.user.role)) return next();
    if (req.user.sub === req.params.id) return next();
    res.status(403).json({ success: false, error: 'forbidden' });
  }];
}

// Resolve the effective group_id for a query/list endpoint.
// Superadmin may pass any groupId (or none, for "all groups").
// Everyone else is pinned to their own group.
function effectiveGroupId(req) {
  if (req.user.role === 'superadmin') return req.query?.groupId || req.body?.groupId || null;
  return req.user.groupId || null;
}

// Assert the caller may act on a resource owned by `targetGroupId`.
// Superadmin → always ok. Others → must match their own groupId.
// Returns true on success; sends 403 and returns false on failure.
function assertGroup(req, res, targetGroupId) {
  if (req.user.role === 'superadmin') return true;
  if (targetGroupId && req.user.groupId === targetGroupId) return true;
  res.status(403).json({ success: false, error: 'forbidden: cross-group access' });
  return false;
}

module.exports = { authRequired, roleRequired, sameGroupOr, selfOr, effectiveGroupId, assertGroup, accessToken, bearerToken, isMobile };
