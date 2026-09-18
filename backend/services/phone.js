const { parsePhoneNumber, isValidPhoneNumber } = require('libphonenumber-js');

function normalize(raw) {
  if (!raw) throw new Error('phone required');
  const s = String(raw).trim();

  let parsed;
  try {
    // Try with IQ country hint first (Iraqi numbers)
    parsed = parsePhoneNumber(s, 'IQ');
  } catch {
    throw new Error('invalid phone number');
  }
  if (!parsed.isValid()) throw new Error('invalid phone number');
  return parsed.format('E.164'); // +9647XXXXXXXXX
}

function hmac(phone, secret) {
  const { createHmac } = require('crypto');
  return createHmac('sha256', secret).update(phone).digest('hex');
}

module.exports = { normalize, hmac };
