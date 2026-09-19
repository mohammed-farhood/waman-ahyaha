// Formatting helpers — kept identical to the website (js/app.js fmt/timeAgo, js/data.js month helpers).
export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function fmt(n: number | string | null | undefined) {
  const v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const money = (n: number | string | null | undefined) => `${fmt(n)} د.ع`;

/** Keep Latin snippets (@bot names, tokens, commands) in their own left-to-right run inside Arabic text. */
export const ltr = (s: string) => `⁦${s}⁩`;

export function timeAgo(date?: string | null) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `منذ ${Math.floor(diff / 86400)} يوم`;
  const d = new Date(date);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The server decides "this month" in Asia/Baghdad (UTC+3, no DST) — use the same clock everywhere.
const BAGHDAD_OFFSET_MS = 3 * 3600 * 1000;
const baghdadNow = () => new Date(Date.now() + BAGHDAD_OFFSET_MS);

/** 'YYYY-MM' in Baghdad time; offset -1 = last month. */
export function monthKey(offset = 0) {
  const n = baghdadNow();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const baghdadDayOfMonth = () => baghdadNow().getUTCDate();

export function monthLabel(key: string, withYear = true) {
  const [y, m] = key.split('-');
  const name = AR_MONTHS[parseInt(m, 10) - 1] ?? key;
  return withYear ? `${name} ${y}` : name;
}

/** Most recent first, e.g. ['2026-09', '2026-08', ...] — the website's grid uses 6. */
export function recentMonths(count = 6) {
  return Array.from({ length: count }, (_, i) => monthKey(-i));
}

/** Iraqi mobile numbers: accepts 07XXXXXXXXX, 7XXXXXXXXX, +9647XXXXXXXXX, 009647… and Arabic digits; returns 07XXXXXXXXX or null. */
export function normalizePhone(raw: string) {
  const d = (raw || '').replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/\D/g, '');
  let local = d;
  if (local.startsWith('00964')) local = local.slice(5);
  else if (local.startsWith('964')) local = local.slice(3);
  if (local.startsWith('7')) local = '0' + local;
  return /^07\d{9}$/.test(local) ? local : null;
}

/** Digits for wa.me / t.me links (website: App.intlPhone). */
export function intlPhone(phone?: string | null) {
  const d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('964')) return d;
  if (d.startsWith('0')) return '964' + d.slice(1);
  return d;
}

/** '+9647XXXXXXXXX' → '07XXXXXXXXX' for display. */
export function localPhone(phone?: string | null) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  return d.startsWith('964') ? '0' + d.slice(3) : phone;
}

export function birthdayInfo(birth?: string | null) {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const [y, m, d] = birth.slice(0, 10).split('-').map(Number);
  const now = baghdadNow();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisYear = Date.UTC(now.getUTCFullYear(), m - 1, d);
  const next = thisYear < today ? Date.UTC(now.getUTCFullYear() + 1, m - 1, d) : thisYear;
  const days = Math.round((next - today) / 86400000);
  const age = now.getUTCFullYear() - y - (thisYear > today ? 1 : 0);
  return { days, age, label: `${d} ${AR_MONTHS[m - 1]} ${y}` };
}

export const initials = (name?: string | null) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join(' ');
