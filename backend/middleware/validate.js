const { z } = require('zod');

function body(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      });
    }
    req.body = result.data;
    next();
  };
}

function query(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
      });
    }
    req.query = result.data;
    next();
  };
}

// Shared field validators
const phoneRaw = z.string().min(6).max(20);
const pinRaw   = z.string().min(4).max(20);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');
const role     = z.enum(['superadmin', 'admin', 'collector', 'donor']);
const amount   = z.number().int().min(0).max(100_000_000);

module.exports = { body, query, phoneRaw, pinRaw, monthKey, role, amount };
