/**
 * qapture config — AL-AYN ("ومن أحياها") donation tracker
 *
 * Tailored by hand from the repo's route/view map (js/app.js, js/auth.js,
 * js/data.js, index.html, backend/routes/*). Re-running `qapture init --force`
 * will overwrite this file with the generic scaffold — don't do that without
 * re-merging these edits back in.
 *
 * NOTE on `path` values below: this app is a single-page app with NO
 * client-side router — App.navigate(viewName) in js/app.js just toggles
 * pre-declared `.view` divs. There is no real URL per screen. The `path`
 * strings here are therefore virtual, human-readable identifiers of the
 * form `/viewName` (matching the view id used in app.js), with a `#fragment`
 * suffix for a specific embedded action/modal inside that view (e.g.
 * `/grid#toggle-donation`). Use them as a destination label when walking
 * through the journey manually, not as a literal address bar URL.
 *
 * Schema reference: https://github.com/mohammed-farhood/qapture#qaconfig
 */

// @ts-check
/** @type {import('qapture').QaConfig} */
const config = {
  namespace: 'al-ayn',
  rtl: true,

  theme: {
    primary: '#2A8FA0', // brand teal (css/main.css --primary)
    primaryDark: '#1D6B79', // css/main.css --primary-dark
    accent: '#C8A92A', // brand gold (css/main.css --gold)
    accentDark: '#A88A20', // css/main.css --gold-dark
    sage: '#64748B', // css/main.css --gray-500 / --text-muted
    cream: '#FDF8EA', // css/main.css --gold-bg (warm cream, matches gold accent family)
    mauve: '#8B6F8F', // muted mauve — no brand equivalent exists; chosen to sit between primary teal and accent gold, reserved for the QA panel's "admin" lane accent
    surface: '#F4F7F9', // css/main.css --bg
    ink: '#0F172A', // css/main.css --text-heading / --gray-900
  },

  brand: {
    label: 'ومن أحياها — QA',
  },

  visible: true,
  alwaysVisible: false,
  hotkey: 'shift+alt+q',

  // Donors/collectors/admins all authenticate with phone number + PIN
  // (js/auth.js → /api/auth/login) — there is no email/username field anywhere.
  loginField: {
    en: 'Phone Number',
    ar: 'رقم الهاتف',
  },

  // DEV/TEST/SEED ONLY — never production, never commit real passwords.
  // Bootstrapped by the backend's dev seed (see backend/.env / backend/.env.example
  // and backend/scripts/). Rotate before any shared/staging deployment.
  credentials: [
    {
      role: 'Superadmin',
      roleAr: 'مدير التطبيق',
      login: '+9647700000001',
      password: '123456',
      seeded: true,
      hint: {
        en: 'Bootstrapped dev superadmin — see backend/.env',
        ar: 'حساب مدير تجريبي',
      },
    },
    {
      role: 'Group Admin',
      roleAr: 'مدير المجموعة',
      login: '+9647700000002',
      password: '123456',
      seeded: true,
      hint: {
        en: 'Test admin — owns group "مجموعة اختبار الجودة"',
        ar: 'حساب مدير مجموعة تجريبي — يملك مجموعة "مجموعة اختبار الجودة"',
      },
    },
    {
      role: 'Collector',
      roleAr: 'المُحصّل',
      login: '+9647700000003',
      password: '123456',
      seeded: true,
      hint: {
        en: 'Test collector — has one donor assigned',
        ar: 'حساب مُحصّل تجريبي — لديه متبرع واحد مُسند إليه',
      },
    },
    {
      role: 'Donor',
      roleAr: 'المتبرع',
      login: '+9647700000004',
      password: '(none — donors log in with phone only)',
      seeded: true,
      hint: {
        en: 'Test donor — no PIN required, leave password blank',
        ar: 'حساب متبرع تجريبي — بدون رمز PIN، اترك كلمة المرور فارغة',
      },
    },
  ],

  journey: [
    // ── Guest / Visitor (unauthenticated) ──────────────────────────────
    {
      id: 'guest',
      color: '#64748B',
      role: { en: 'Guest / Visitor', ar: 'زائر / غير مسجل' },
      steps: [
        {
          path: '/',
          risk: 'green',
          what: {
            en: 'Browse the public landing page — active donation groups, stats, and entry links to login/register/newcampaign',
            ar: 'تصفح الصفحة الرئيسية العامة — المجموعات النشطة والإحصاءات وروابط الدخول والتسجيل وطلب حملة',
          },
          riskWhy: 'Pure display, no auth or money action',
        },
        {
          path: '/login',
          risk: 'red',
          what: {
            en: 'Log in with phone number + PIN',
            ar: 'تسجيل الدخول برقم الهاتف ورمز PIN',
          },
          riskWhy:
            'Authentication/credential entry — canonical RED bucket; server intentionally returns a generic error to prevent phone-number enumeration',
        },
        {
          path: '/register',
          risk: 'red',
          what: {
            en: 'Self-register as a new donor (name, phone, group, collector, monthly pledge amount)',
            ar: 'التسجيل الذاتي كمتبرع جديد (الاسم، الهاتف، المجموعة، المُحصّل، مبلغ التعهد الشهري)',
          },
          riskWhy:
            'Creates a real credentialed identity tied to a phone number and commits a recurring pledge amount',
        },
        {
          path: '/newcampaign',
          risk: 'amber',
          what: {
            en: "Submit the 'Start Your Campaign' lead-gen contact form",
            ar: "إرسال نموذج التواصل 'ابدأ حملتك'",
          },
          riskWhy:
            'Saves a campaign_request row and offers WhatsApp/Telegram contact links; does NOT create an actual campaign — recoverable, no money moves',
        },
      ],
    },

    // ── Donor / User (authenticated, lowest privilege) ─────────────────
    {
      id: 'donor',
      color: '#2A8FA0',
      role: { en: 'Donor / User', ar: 'المتبرع / المستخدم' },
      steps: [
        {
          path: '/home',
          risk: 'green',
          what: {
            en: 'View the donor dashboard (own payment status)',
            ar: 'عرض لوحة المتبرع (حالة السداد الخاصة به)',
          },
          riskWhy: 'Stats + navigation only, no mutation',
        },
        {
          path: '/grid',
          risk: 'red',
          what: {
            en: "View own monthly donation grid (read-only paid/unpaid cells)",
            ar: 'عرض شبكة التبرعات الشهرية الخاصة به (خلايا مدفوع/غير مدفوع للقراءة فقط)',
          },
          riskWhy:
            'Grid is graded RED overall because collector/admin/superadmin can mutate the ledger from this exact screen — for the donor role, verify it truly stays read-only with no stray write access',
        },
        {
          path: '/news',
          risk: 'green',
          what: {
            en: 'Read the announcements/bulletin feed',
            ar: 'قراءة لوحة الإعلانات والنشرات',
          },
          riskWhy: 'Informational content board only',
        },
        {
          path: '/leaderboard',
          risk: 'green',
          what: {
            en: 'View the cross-group leaderboard (monthly completion % and all-time totals)',
            ar: 'عرض لوحة الصدارة بين المجموعات',
          },
          riskWhy: 'Read-only aggregation display',
        },
        {
          path: '/collectors',
          risk: 'red',
          what: {
            en: 'Browse the collector directory (contact info, availability, live GPS)',
            ar: 'تصفح دليل المُحصّلين',
          },
          riskWhy:
            'Directory itself is read-only for donors, but the view is graded RED overall because collector/admin/superadmin can file or acknowledge cross-collector pay reports from this same screen',
        },
        {
          path: '/institution',
          risk: 'amber',
          what: {
            en: 'Visit the parent-NGO hub (حساب العين) and submit a support message',
            ar: 'زيارة صفحة المؤسسة الأم (حساب العين) وإرسال رسالة دعم',
          },
          riskWhy:
            "saveSupportMessage → POST /api/support-messages — rubric's 'support messages' bucket; recoverable inbound record",
        },
        {
          path: '/orphans',
          risk: 'amber',
          what: {
            en: 'View the orphan roster (sponsorship code, province, pledge, birthday countdown)',
            ar: 'عرض قائمة الأيتام',
          },
          riskWhy:
            'Read-only for donors; the view is graded AMBER overall because collector/admin/superadmin can add/edit/delete orphans from this same screen',
        },
        {
          path: '/profile',
          risk: 'green',
          what: {
            en: 'View/edit own profile: avatar, theme toggle, Telegram link',
            ar: 'عرض/تعديل الملف الشخصي: الصورة، تبديل السمة، ربط تيليجرام',
          },
          riskWhy:
            'Base profile is self-service only at this role — no export/import capability shown',
        },
      ],
    },

    // ── Collector (field collector, single group) ───────────────────────
    {
      id: 'collector',
      color: '#C8A92A',
      role: { en: 'Collector', ar: 'المُحصّل' },
      steps: [
        {
          path: '/home',
          risk: 'green',
          what: {
            en: "View the collector dashboard (own donor roster's completion %)",
            ar: 'عرض لوحة المُحصّل (نسبة إنجاز المتبرعين الخاصين به)',
          },
          riskWhy: 'Stats + navigation only',
        },
        {
          path: '/grid#toggle-donation',
          risk: 'red',
          what: {
            en: "Toggle a donation cell paid/unpaid for one of the collector's own donors",
            ar: 'تبديل حالة خلية تبرع (مدفوع/غير مدفوع) لأحد متبرعي المُحصّل',
          },
          riskWhy:
            'toggleDonation → PUT /api/donations/... — direct financial-ledger write; the core money-recording action of the app',
        },
        {
          path: '/grid#add-donor',
          risk: 'amber',
          what: {
            en: 'Add a new donor from the grid screen',
            ar: 'إضافة متبرع جديد من شاشة الشبكة',
          },
          riskWhy: 'Creates/links a donor account; recoverable',
        },
        {
          path: '/news#post',
          risk: 'green',
          what: {
            en: 'Post, pin, edit, or delete an announcement (optionally with an image)',
            ar: 'نشر أو تثبيت أو تعديل أو حذف إعلان',
          },
          riskWhy: 'Moderation-level content action — reversible, no money or irreversible state',
        },
        {
          path: '/collectors#pay-report',
          risk: 'red',
          what: {
            en: "File a pay report claiming receipt of a donation belonging to another collector's donor",
            ar: 'تقديم بلاغ استلام دفعة تخص متبرع مُحصّل آخر',
          },
          riskWhy:
            'savePayReport / acknowledgePayReport records money receipt — same bucket as donation-grid toggling',
        },
        {
          path: '/orphans#crud',
          risk: 'amber',
          what: {
            en: 'Add, edit, or delete an orphan record',
            ar: 'إضافة أو تعديل أو حذف سجل يتيم',
          },
          riskWhy: 'Recoverable record-keeping, no direct money movement',
        },
        {
          path: '/profile#gps',
          risk: 'amber',
          what: {
            en: 'Toggle live GPS location broadcast',
            ar: 'تبديل بث الموقع الجغرافي المباشر',
          },
          riskWhy:
            'toggleGPS publishes real-time location to donors via Telegram; recoverable (can be switched back off)',
        },
        {
          path: '/profile#availability',
          risk: 'green',
          what: {
            en: 'Edit availability schedule',
            ar: 'تعديل جدول التوفر',
          },
          riskWhy: 'Self-service scheduling only',
        },
      ],
    },

    // ── Group Admin (single group, elevated) ────────────────────────────
    {
      id: 'admin',
      color: '#8B6F8F',
      role: { en: 'Group Admin', ar: 'مدير المجموعة' },
      steps: [
        {
          path: '/home',
          risk: 'green',
          what: {
            en: 'View the admin dashboard (collector performance across the group)',
            ar: 'عرض لوحة المدير (أداء المُحصّلين في المجموعة)',
          },
          riskWhy: 'Stats + navigation only — the RED create/delete-campaign actions live one level up, in the superadmin variant of this same view',
        },
        {
          path: '/grid#toggle-donation',
          risk: 'red',
          what: {
            en: 'Toggle a donation cell paid/unpaid for any donor in the group',
            ar: 'تبديل حالة خلية تبرع لأي متبرع في المجموعة',
          },
          riskWhy: 'Direct financial-ledger write, group-wide scope',
        },
        {
          path: '/grid#export-csv',
          risk: 'amber',
          what: {
            en: 'Export the donation grid to CSV',
            ar: 'تصدير شبكة التبرعات إلى ملف CSV',
          },
          riskWhy:
            'exportGridToCSV exports names/phones/payment status — smaller-scope data-egress than a full backup, but still egress',
        },
        {
          path: '/collectors#acknowledge',
          risk: 'red',
          what: {
            en: 'Acknowledge a cross-collector pay report',
            ar: 'اعتماد بلاغ دفعة بين المُحصّلين',
          },
          riskWhy: 'acknowledgePayReport sets a donation to paid=true based on another collector\'s claim',
        },
        {
          path: '/orphans#crud',
          risk: 'amber',
          what: {
            en: 'Add, edit, or delete an orphan record',
            ar: 'إضافة أو تعديل أو حذف سجل يتيم',
          },
          riskWhy: 'Recoverable record-keeping',
        },
        {
          path: '/profile#add-collector',
          risk: 'amber',
          what: {
            en: 'Add a new collector account (creates a login + PIN)',
            ar: 'إضافة حساب مُحصّل جديد',
          },
          riskWhy: "Collectors-management bucket — creates a new credentialed account",
        },
        {
          path: '/profile#export-json',
          risk: 'red',
          what: {
            en: 'Export local data (users, donations, etc.) as JSON',
            ar: 'تصدير البيانات المحلية بصيغة JSON',
          },
          riskWhy:
            'exportData — same data-export bucket as the superadmin full backup, lower-privileged/narrower variant',
        },
      ],
    },

    // ── Superadmin (cross-group, highest privilege) ─────────────────────
    {
      id: 'superadmin',
      color: '#DC2626',
      role: { en: 'Superadmin', ar: 'مدير التطبيق' },
      steps: [
        {
          path: '/home',
          risk: 'red',
          what: {
            en: 'View the cross-group superadmin dashboard',
            ar: 'عرض لوحة مدير التطبيق (كل المجموعات)',
          },
          riskWhy:
            "renderSuperAdminHome() embeds an 'Add Campaign' button and a per-group settings gear directly on the dashboard — RED actions living inside what is otherwise a stats screen",
        },
        {
          path: '/home#create-campaign',
          risk: 'red',
          what: {
            en: 'Create a new campaign (group) with its first admin account',
            ar: 'إنشاء حملة (مجموعة) جديدة مع أول حساب مدير لها',
          },
          riskWhy:
            'submitSuperAdminCreateCampaign creates a brand-new group plus its first admin account (with a PIN), server-side',
        },
        {
          path: '/home#delete-campaign',
          risk: 'red',
          what: {
            en: 'Fully delete a campaign (group)',
            ar: 'حذف حملة (مجموعة) بالكامل',
          },
          riskWhy:
            "submitFullDeleteCampaign — irreversible cascade delete of a group and all its admins/collectors/donors/orphans/announcements/donations; gated behind re-entering the superadmin's own PIN",
        },
        {
          path: '/grid#group-picker',
          risk: 'red',
          what: {
            en: 'Switch between groups and toggle a donation cell in any group',
            ar: 'التبديل بين المجموعات وتبديل حالة خلية تبرع في أي مجموعة',
          },
          riskWhy: 'Cross-group financial-ledger write',
        },
        {
          path: '/collectors#acknowledge',
          risk: 'red',
          what: {
            en: 'Acknowledge a cross-collector pay report in any group',
            ar: 'اعتماد بلاغ دفعة بين المُحصّلين في أي مجموعة',
          },
          riskWhy: 'acknowledgePayReport, cross-group scope',
        },
        {
          path: '/profile#full-backup',
          risk: 'red',
          what: {
            en: 'Export a full database backup',
            ar: 'تصدير نسخة احتياطية كاملة لقاعدة البيانات',
          },
          riskWhy: 'exportFullBackup — whole-database export, canonical data export/import/wipe bucket',
        },
        {
          path: '/profile#import-restore',
          risk: 'red',
          what: {
            en: 'Import/restore data from a backup file',
            ar: 'استيراد/استعادة البيانات من ملف نسخة احتياطية',
          },
          riskWhy: 'handleImportRestore performs a server-side merge-import that can overwrite live data',
        },
        {
          path: '/profile#backup-history',
          risk: 'green',
          what: {
            en: 'View the backup history list',
            ar: 'عرض سجل النسخ الاحتياطية',
          },
          riskWhy: 'showBackupHistoryModal is a read-only list of past backups, no data movement',
        },
        {
          path: '/orphans#crud',
          risk: 'amber',
          what: {
            en: 'Add, edit, or delete an orphan record in any group',
            ar: 'إضافة أو تعديل أو حذف سجل يتيم في أي مجموعة',
          },
          riskWhy: 'Recoverable record-keeping, cross-group scope',
        },
      ],
    },
  ],

  /**
   * preamble — read by your AI coding agent (Claude Code, Cursor, Windsurf, etc.)
   * when it processes a qa-notes-*.zip export. Kept in sync with qa.preamble.md
   * (that file is the human-readable mirror; this object is what's actually
   * embedded in exports).
   */
  preamble: {
    projectName: 'ومن أحياها — AL-AYN Donation Tracker',
    oneLiner:
      'A bilingual (Arabic/English), RTL-first donation-tracking PWA for charity donor groups: field collectors record monthly pledge payments, group admins and a cross-group superadmin manage groups/collectors/orphans, and donors track their own payment status.',
    stack:
      'Vanilla JS frontend (no framework, no bundler — plain <script> tags), Node.js + Express backend, PostgreSQL database, RTL/Arabic-first UI',
    runCommands: [
      'cd backend && node server.js   # backend API — http://localhost:7860 (and http://<lan-ip>:7860)',
      'npx serve . -l 5500            # or any static file server — frontend on http://localhost:5500 (and http://<lan-ip>:5500)',
      '# Both servers must be reachable over the LAN for on-device/mobile QA;',
      "# the backend's CORS origin allowlist must include the LAN origin you test from.",
    ],
    conventions: [
      '1. No build step — edit js/*.js and css/main.css directly; changes are live on reload, nothing to compile or bundle.',
      '2. All UI strings and logic must stay bilingual/RTL-aware (Arabic is the primary/default language; layout mirrors for RTL).',
      '3. Vanilla DOM manipulation throughout — no virtual DOM, no component framework; views are toggled by App.navigate(viewName) in js/app.js.',
    ],
    invariants: [
      'Donation/payment amounts must never be negative.',
      'Phone numbers are normalized to E.164 and HMAC-hashed before storage — never stored raw.',
      'PINs are bcrypt-hashed before storage — never stored or logged in plaintext.',
      'All mutating /api routes require a valid CSRF token.',
      "The backend's CORS origin allowlist is enforced — requests from origins outside the allowlist must be rejected.",
    ],
    verifySteps: [
      '1. Open the app (frontend static server, see runCommands).',
      '2. Log in with the seeded superadmin credentials listed in `credentials` above.',
      '3. Navigate to the view under test (see `journey` above for the full role-by-role map).',
      '4. Confirm the expected UI state after the action (correct data shown, correct role-gating, correct language/RTL layout).',
      '5. Open devtools and check for console errors and failed/unexpected network requests before signing off.',
    ],
    additionalContext:
      "Two known gaps worth keeping in mind while testing: (1) the `leaderboard` and `institution` views have no auth guard in their render*() functions in js/app.js (unlike home/grid/news/profile, which redirect to `landing` if no user is logged in) — they're only unreachable by guests today because no UI link exists pre-login, not because the code enforces it; a regression there would be a silent guard removal, not a new bug. (2) There is no self-service PIN/credential-change view anywhere in the frontend — PINs are only ever set at account-creation time (collector/admin creation modals, or the superadmin campaign-creation modal); the only PIN re-entry point is re-authentication before a destructive action (campaign full-delete). Donors authenticate with phone-only (no PIN) unless the server flags require_pin, which is reserved for collector/admin/superadmin accounts.",
  },
};

export default config;
