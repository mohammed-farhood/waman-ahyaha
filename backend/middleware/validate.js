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

// Staff PINs guard money records: refuse the obvious ones.
const WEAK_PINS = new Set(['1234', '12345', '123456', '1234567', '12345678', '4321', '0123', '1212', '123123']);
function isWeakPin(pin) {
  const p = String(pin);
  return WEAK_PINS.has(p) || /^(.)\1+$/.test(p);   // e.g. 0000, 111111
}

// Shared field validators
const phoneRaw  = z.string().min(6).max(20);
const pinRaw    = z.string().min(4).max(20);
const strongPin = pinRaw.refine(p => !isWeakPin(p), 'PIN too weak');
const monthKey  = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');
const role      = z.enum(['superadmin', 'admin', 'collector', 'donor']);
const amount    = z.number().int().min(0).max(100_000_000);

module.exports = { body, phoneRaw, pinRaw, strongPin, isWeakPin, monthKey, role, amount };
