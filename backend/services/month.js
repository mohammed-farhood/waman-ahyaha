// Month keys ('YYYY-MM') are always computed in Iraq time, whatever the server's
// clock or timezone. toISOString() is UTC and flips the month three hours late.
const TZ = 'Asia/Baghdad';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });

function monthKey(date = new Date()) {
  return fmt.format(date).slice(0, 7);   // en-CA gives "2026-09"
}

// monthKey shifted by `delta` months (negative = earlier).
function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = { monthKey, addMonths, MONTH_RE };
