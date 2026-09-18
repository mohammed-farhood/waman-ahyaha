/* ============================================================
   WAMAN-AHYAHA DONATION TRACKER — MAIN APPLICATION
   ============================================================ */
// API base is set by index.html via window.WAMAN_API, or falls back to same origin.
// apiClient.js reads API.BASE from window.WAMAN_API automatically.
const API_BASE_URL = window.WAMAN_API || '';

const App = {
  currentView: 'landing',

  // Phone as international digits for wa.me / t.me links. The server stores
  // E.164 (+9647XXXXXXXXX); older cached rows may still be local (07XXXXXXXXX).
  intlPhone(phone) {
    const d = String(phone || '').replace(/[^\d]/g, '');
    if (d.startsWith('964')) return d;
    if (d.startsWith('0'))   return '964' + d.slice(1);
    return d;
  },

  // XSS Prevention: Sanitize user-provided strings before inserting into DOM
  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  async init() {
    const savedTheme = DB.getSetting('theme', null);
    const theme = savedTheme
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    this._updateThemeIcon();
    this._guardAsync(['handleLogin', 'handleRegister', 'handleAddDonor', 'handleAddCollector',
      '_submitPayReport', 'submitCampaignRequest', 'submitSupportMessage', 'handleAddOrphan',
      'handleEditOrphan', 'handleAvailability', 'sendBotReminders', 'acknowledgePayReport',
      'submitDeleteAccount']);
    this._initChrome();
    console.log("WAMAN-AHYAHA App Initialized v4.0.0");

    // Re-authenticate with server if we have a cached session
    if (Auth.isLoggedIn()) {
      this._renderSkeleton();
      const result = await Auth.bootstrap().catch(() => ({ error: 'bootstrap failed' }));
      if (result.error === 'unauthenticated') {
        DB.logout();
        this.navigate('landing');
      } else {
        this.navigate('home');
      }
    } else {
      this.navigate('landing');
      // Visitors have no cache yet: load the public campaign list, then redraw.
      DB.refreshGroups().then(ok => { if (ok && this.currentView === 'landing') this.renderLanding(); });
    }
    SyncQueue._flush();

    // A queued change the server refused (bad data / not allowed) — tell the user.
    window.addEventListener('waman:syncFailed', (e) => {
      const msg = e.detail?.error || '';
      this.toast('لم يتم حفظ أحد التغييرات على الخادم' + (msg ? ': ' + msg : ''), 'error');
    });

    // Listen for server-side logout (401 on any request)
    window.addEventListener('waman:loggedOut', () => {
      DB.logout();
      this.navigate('landing');
      this.toast('انتهت جلستك، يرجى تسجيل الدخول مجدداً', 'warning');
    });

    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
      item.addEventListener('click', () => this.navigate(item.dataset.view));
    });
  },

  // ─────────────────────────────────────────────────────────────
  // NEW: SUPER ADMIN HELPERS
  // ─────────────────────────────────────────────────────────────
  superAdminViewGroup(groupId) {
    this._superAdminActiveGroup = groupId;
    this.navigate('grid');
  },

  _getEffectiveGroupId() {
    const user = Auth.currentUser();
    if (user && user.role === 'superadmin') {
      if (this._superAdminActiveGroup) {
        return this._superAdminActiveGroup;
      } else {
        const groups = DB.getAllGroupsList();
        if (groups.length > 0) {
          this._superAdminActiveGroup = groups[0].id;
          return groups[0].id;
        }
      }
    }
    return user ? user.groupId : null;
  },

  navigate(viewName) {
    // Clean up any active Telegram polling interval when navigating away
    if (this._tgPollInterval) {
      clearInterval(this._tgPollInterval);
      this._tgPollInterval = null;
    }
    if (this._tgPollTimeout) {
      clearTimeout(this._tgPollTimeout);
      this._tgPollTimeout = null;
    }
    this.currentView = viewName;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    const bottomNav = document.getElementById('bottom-nav');
    const navTitle  = document.getElementById('nav-title');
    const isAuth    = Auth.isLoggedIn();
    const noNav     = ['landing','login','register','newcampaign'].includes(viewName);

    bottomNav.classList.toggle('hidden', !isAuth || noNav);

    const views = {
      landing:     ['landing', 'ومن أحياها — متابعة التبرعات'],
      login:       ['login',   'تسجيل الدخول'],
      register:    ['register','إنشاء حساب'],
      home:        ['home',    'الرئيسية'],
      grid:        ['grid',    'جدول التبرعات'],
      news:        ['news',    'الأخبار'],
      leaderboard: ['leaderboard','المنافسة'],
      collectors:  ['collectors', 'المسؤولون'],
      profile:     ['profile', 'حسابي'],
      newcampaign: ['newcampaign', 'ابدأ حملتك'],
      institution: ['institution', 'عن المنصة'],
      orphans:     ['orphans', 'الأيتام'],
    };

    const [id, title] = views[viewName] || ['landing','ومن أحياها'];
    navTitle.textContent = title;

    const renders = {
      landing:     () => this.renderLanding(),
      login:       () => this.renderLogin(),
      register:    () => this.renderRegister(),
      home:        () => this.renderHome(),
      grid:        () => this.renderGrid(),
      news:        () => this.renderNews(),
      leaderboard: () => this.renderLeaderboard(),
      collectors:  () => this.renderCollectors(),
      profile:     () => this.renderProfile(),
      newcampaign: () => this.renderNewCampaign(),
      institution: () => this.renderInstitution(),
      orphans:     () => this.renderOrphans(),
    };

    const viewId = `view-${viewName}`;
    const navBrand = document.querySelector('.nav-brand');
    const btnLogout = document.getElementById('btn-logout');
    const btnRefresh = document.getElementById('btn-refresh');
    const btnBack = document.getElementById('btn-back');

    if (viewId === 'view-landing' || viewId === 'view-login' || viewId === 'view-register') {
      bottomNav.classList.add('hidden');
      navBrand.style.pointerEvents = 'none';
      if(btnLogout) btnLogout.style.display = 'none';
      if(btnRefresh) btnRefresh.style.display = 'none';
      if(btnBack) btnBack.style.display = 'none';
      setTimeout(() => document.getElementById('main-content').scrollTop = 0, 50);
    } else {
      bottomNav.classList.remove('hidden');
      navBrand.style.pointerEvents = 'auto';
      if(btnLogout) btnLogout.style.display = 'inline-flex';
      if(btnRefresh) btnRefresh.style.display = 'inline-flex';
      
      // Show back button on all auth views EXCEPT home
      if(btnBack) {
        btnBack.style.display = viewName === 'home' ? 'none' : 'inline-flex';
      }

      document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    }

    if (renders[viewName]) renders[viewName]();

    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.view === viewName) item.classList.add('active');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  goBack() {
    this.navigate('home');
  },

  _show(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); el.innerHTML = ''; }
    return el;
  },


  // ── TOAST ────────────────────────────────────────────────
  // toast(msg, 'success'|'error'|'warning'|'info', { duration, action: { label, onClick } })
  toast(msg, type = 'success', opts = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    while (container.children.length >= 3) container.firstElementChild.remove();
    const life = opts.duration || (type === 'error' ? 6000 : type === 'warning' ? 4500 : 3200);
    const color = { success: 'success', error: 'danger', warning: 'warning', info: 'primary' }[type] || 'success';
    const icons = {
      success: Icons.check,
      error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      warning: Icons.bell,
      info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.style.setProperty('--toast-life', life + 'ms');
    t.innerHTML = `<span class="icon icon-sm" style="color:var(--${color})">${icons[type] || icons.success}</span>`
      + `<span class="toast-text">${this.esc(msg)}</span>`
      + (opts.action ? `<button class="toast-action" type="button">${this.esc(opts.action.label)}</button>` : '');
    let timer;
    const remove = () => { clearTimeout(timer); t.remove(); };
    t.addEventListener('click', remove);                         // tap to dismiss
    if (opts.action) {
      t.querySelector('.toast-action').addEventListener('click', (e) => {
        e.stopPropagation(); remove(); opts.action.onClick();
      });
    }
    container.appendChild(t);
    timer = setTimeout(() => t.remove(), life);
    return t;
  },

  // Busy state + double-tap protection for async actions. Wraps the named App
  // methods: the button that triggered the call gets a spinner and is disabled
  // until the action finishes; repeated calls while it runs are ignored.
  _guardAsync(names) {
    this._busy = this._busy || {};
    names.forEach(name => {
      const fn = this[name];
      if (typeof fn !== 'function') return;
      this[name] = async function (...args) {
        if (this._busy[name]) return;
        const ev = window.event;
        let btn = ev && ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn) btn = document.querySelector('.modal-overlay.active [data-primary], .view.active [data-primary]');
        this._busy[name] = true;
        if (btn) {
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          btn.insertAdjacentHTML('afterbegin', '<span class="btn-spinner" aria-hidden="true"></span>');
        }
        try { return await fn.apply(this, args); }
        finally {
          this._busy[name] = false;
          if (btn && btn.isConnected) {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            btn.querySelector(':scope > .btn-spinner')?.remove();
          }
        }
      };
    });
  },

  // App-wide chrome: keyboard shortcuts in modals, offline/pending pill,
  // refresh button, quiet refresh when returning to the app.
  _initChrome() {
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) refreshBtn.innerHTML = Icons.refresh;

    document.addEventListener('keydown', (e) => {
      const ov = document.getElementById('modal-overlay');
      if (!ov || !ov.classList.contains('active')) return;
      if (e.key === 'Escape') { e.preventDefault(); this.closeModal(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        const el = e.target;
        // Inputs with their own Enter handler keep it; textareas keep new lines.
        if (!el || el.tagName !== 'INPUT' || el.hasAttribute('onkeyup') || el.hasAttribute('onkeydown')) return;
        if (['checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type)) return;
        const primary = ov.querySelector('[data-primary]')
          || ov.querySelector('.btn-primary:not([disabled]), .btn-gold:not([disabled])');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    });

    const upd = () => this._updateSyncPill();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    setInterval(upd, 3000);
    upd();

    this._lastRefresh = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Auth.isLoggedIn()
          && Date.now() - (this._lastRefresh || 0) > 5 * 60 * 1000) {
        this.refresh({ silent: true });
      }
    });
  },

  _updateSyncPill() {
    const pill = document.getElementById('sync-pill');
    if (!pill) return;
    const n = typeof SyncQueue !== 'undefined' ? SyncQueue.pendingCount() : 0;
    if (!navigator.onLine) {
      pill.className = 'sync-pill offline';
      pill.innerHTML = '<span class="dot"></span>غير متصل' + (n ? ` · ${this.fmt(n)}` : '');
      pill.title = n ? `${n} تغيير بانتظار عودة الاتصال` : 'لا يوجد اتصال بالإنترنت';
    } else if (n > 0) {
      pill.className = 'sync-pill';
      pill.innerHTML = `<span class="dot"></span>جاري الحفظ (${this.fmt(n)})`;
      pill.title = 'تغييرات بانتظار الرفع إلى الخادم';
    } else {
      pill.className = 'sync-pill hidden';
      pill.textContent = '';
    }
  },

  // Re-render the current screen without navigation side effects.
  _rerender() {
    const fn = { home: 'renderHome', grid: 'renderGrid', news: 'renderNews', leaderboard: 'renderLeaderboard',
      collectors: 'renderCollectors', profile: 'renderProfile', institution: 'renderInstitution',
      orphans: 'renderOrphans' }[this.currentView];
    if (!fn) return;
    const y = window.scrollY;
    this[fn]();
    window.scrollTo(0, y);
  },

  async refresh({ silent = false } = {}) {
    if (this._refreshing || !Auth.isLoggedIn()) return;
    this._refreshing = true;
    const btn = document.getElementById('btn-refresh');
    btn?.classList.add('is-spinning');
    try {
      SyncQueue._flush();
      const r = await Auth.bootstrap();
      if (r?.error) throw new Error(r.error);
      this._lastRefresh = Date.now();
      if (!document.getElementById('modal-overlay').classList.contains('active')) this._rerender();
      if (!silent) this.toast('تم تحديث البيانات', 'info');
    } catch {
      if (!silent) this.toast('تعذر التحديث، تحقق من الاتصال', 'error');
    } finally {
      this._refreshing = false;
      btn?.classList.remove('is-spinning');
    }
  },

  // Placeholder shown while the saved session loads (instead of a blank screen).
  _renderSkeleton() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const v = document.getElementById('view-home');
    if (!v) return;
    v.classList.add('active');
    v.innerHTML = `
      <div class="container" aria-busy="true" aria-label="جاري التحميل">
        <div class="skeleton sk-hero"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div class="skeleton sk-stat"></div><div class="skeleton sk-stat"></div>
          <div class="skeleton sk-stat"></div><div class="skeleton sk-stat"></div>
        </div>
        <div class="skeleton sk-line" style="width:40%"></div>
        <div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>
      </div>`;
  },

  // Month pills above the grid: jump to that month's column and flash it.
  _focusMonth(i) {
    document.querySelectorAll('#view-grid .month-pill').forEach((p, j) => p.classList.toggle('active', j === i));
    const th = document.querySelector(`#view-grid .donation-grid th[data-month="${i}"]`);
    if (!th) return;
    th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    document.querySelectorAll(`#view-grid .donation-grid tr > :nth-child(${i + 2})`).forEach(c => {
      c.classList.remove('col-flash'); void c.offsetWidth; c.classList.add('col-flash');
    });
  },

  _changeLoginPhone() {
    const phone = document.getElementById('login-phone');
    const pinGroup = document.getElementById('pin-group');
    const pin = document.getElementById('login-pin');
    if (pin) pin.value = '';
    pinGroup?.classList.add('hidden');
    if (phone) { phone.disabled = false; phone.focus(); phone.select(); }
  },

  // ── FORMAT HELPERS ───────────────────────────────────────
  fmt(n) {
    return new Intl.NumberFormat('en-US').format(n || 0);
  },
  timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60) return 'الآن';
    if (diff < 3600) return `منذ ${Math.floor(diff/60)} دقيقة`;
    if (diff < 86400) return `منذ ${Math.floor(diff/3600)} ساعة`;
    if (diff < 604800) return `منذ ${Math.floor(diff/86400)} يوم`;
    return new Date(dateStr).toLocaleDateString('ar-EG-u-nu-latn');
  },

  // ── THEME ────────────────────────────────────────────────
  toggleTheme() {
    const cur  = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    DB.saveSetting('theme', next);
    this._updateThemeIcon();
  },
  _updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    // Browser / phone status bar matches the top bar.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1E293B' : '#FFFFFF');
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    btn.innerHTML = isDark ? Icons.sun : Icons.moon;
  },

  // ── MODAL ────────────────────────────────────────────────
  closeModal() {
    const ov = document.getElementById('modal-overlay');
    if (!ov || !ov.classList.contains('active')) return;
    ov.classList.remove('active');
    document.body.classList.remove('modal-open');
    const back = this._modalReturnFocus;
    this._modalReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch {}
    }
  },
  _openModal(html) {
    const ov = document.getElementById('modal-overlay');
    const m = document.getElementById('modal-content');
    if (!ov.classList.contains('active')) this._modalReturnFocus = document.activeElement;
    m.innerHTML = `<div class="modal-handle"></div>${html}`;
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    const title = m.querySelector('.modal-title');
    if (title) { title.id = 'modal-title'; m.setAttribute('aria-labelledby', 'modal-title'); }
    else m.removeAttribute('aria-labelledby');
    m.scrollTop = 0;
    ov.classList.add('active');
    document.body.classList.add('modal-open');
    // Focus the first field where there is a physical keyboard; on phones that
    // would pop the on-screen keyboard over the form uninvited.
    if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      setTimeout(() => m.querySelector('input:not([type=hidden]):not([disabled]), textarea, select')?.focus(), 60);
    }
  },

  // ─────────────────────────────────────────────────────────
  // LANDING
  // ─────────────────────────────────────────────────────────
  renderLanding() {
    const view   = this._show('view-landing');
    const groups = DB.getAllGroupsList();
    const totalOrphans = groups.reduce((s,g) => s + (g.orphansSponsored||0), 0);
    const cachedDonors = Object.values(DB.getUsers()).filter(u => u.role === 'donor').length;
    const totalDonors  = cachedDonors || groups.reduce((s,g) => s + (g.donor_count||0), 0);

    view.innerHTML = `
      <div class="hero">
        <div class="hero-content">
          <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(200,169,42,.18);border:1px solid rgba(200,169,42,.35);padding:6px 18px;border-radius:999px;color:var(--gold-light);font-size:.8125rem;font-weight:700;letter-spacing:.5px;margin-bottom:20px">
            <span class="icon icon-sm" style="color:var(--gold-light)">${Icons.shield}</span>
            ومن أحياها
          </div>
          <h1>متابعة التبرعات الشهرية<br>لكفالة الأيتام</h1>
          <p>منصة شفافة تُمكّن المجموعات الجامعية من متابعة تبرعاتها وتحفيز المنافسة الإيجابية</p>
          <div class="hero-actions">
            <div class="hero-actions-main">
              <button class="btn btn-gold btn-xl" onclick="App.navigate('login')">تسجيل الدخول</button>
              <button class="btn btn-outline btn-xl" style="border-color:rgba(255,255,255,.5);color:white" onclick="App.navigate('register')">انضم كمتبرع</button>
            </div>
            <button class="btn btn-lg hero-cta-campaign" onclick="App.navigate('newcampaign')">
              <span class="icon icon-sm">${Icons.plus}</span>
              هل تريد تأسيس حملة جديدة؟ ابدأ من هنا
            </button>
          </div>
          <div class="hero-stats">
            <div><span class="hero-stat-value">${this.fmt(totalOrphans)}</span><span class="hero-stat-label">يتيم مكفول</span></div>
            <div><span class="hero-stat-value">${this.fmt(groups.length)}</span><span class="hero-stat-label">مجموعة جامعية</span></div>
            <div><span class="hero-stat-value">${this.fmt(totalDonors)}</span><span class="hero-stat-label">متبرع نشط</span></div>
          </div>
        </div>
      </div>

      <div class="container">
        <div class="section-header"><h3 class="section-title">المجموعات النشطة</h3></div>
        ${groups.map(g => {
          const stats = DB.getMonthlyStats(g.id, DB.getCurrentMonthKey());
          return `
          <div class="card card-hover" style="margin-bottom:12px;cursor:pointer" onclick="App.navigate('login')">
            <div class="flex-between" style="margin-bottom:14px">
              <div>
                <div class="font-bold" style="font-size:1.0625rem;color:var(--text-heading)">${this.esc(g.name)}</div>
                <div class="text-sm text-muted" style="margin-top:3px">${this.esc(g.university)} &nbsp;·&nbsp; ${g.orphansSponsored} يتيم مكفول</div>
              </div>
              <span class="badge badge-primary">${stats.completionRate}%</span>
            </div>
            <div class="progress"><div class="progress-bar" style="width:${stats.completionRate}%"></div></div>
            <div class="flex-between" style="margin-top:10px">
              <span style="font-size:.8125rem;color:var(--text-muted)">${stats.paidCount} من ${stats.totalDonors} متبرع</span>
              <span style="font-size:.8125rem;font-weight:700;color:var(--primary)">${this.fmt(stats.totalAmount)} د.ع</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────────────────
  renderLogin() {
    const view = this._show('view-login');
    view.innerHTML = `
      <div class="auth-page">
        <div class="auth-card fade-up">
          <div class="auth-card-top">
            <div class="auth-card-logo">${Icons.shield}</div>
            <h3>تسجيل الدخول</h3>
            <p class="text-muted" style="font-size:.9rem;margin-top:4px">أدخل رقم هاتفك للمتابعة</p>
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="tel" id="login-phone" class="form-input" placeholder="07xxxxxxxxx" autocomplete="tel" inputmode="tel" enterkeyhint="next" dir="ltr" style="text-align:center;font-size:1.1rem;letter-spacing:2px" onkeyup="if(event.key==='Enter')App.handleLogin()">
          </div>
          <div id="pin-group" class="form-group hidden" style="margin-top:16px;">
            <div class="flex-between" style="margin-bottom:6px">
              <label class="form-label" for="login-pin" style="margin:0">رمز الدخول / كلمة المرور</label>
              <button type="button" class="btn btn-ghost btn-xs" onclick="App._changeLoginPhone()">تغيير الرقم</button>
            </div>
            <input type="password" id="login-pin" class="form-input" placeholder="••••" maxlength="20" autocomplete="current-password" enterkeyhint="go" style="text-align:center;font-size:1.25rem;letter-spacing:4px" onkeyup="if(event.key==='Enter')App.handleLogin()">
          </div>
          <button class="btn btn-primary w-full btn-lg" data-primary onclick="App.handleLogin()">
            <span class="icon icon-sm">${Icons.shield}</span>دخول
          </button>
          <div class="auth-divider">أو</div>
          <button class="btn btn-outline w-full" onclick="App.navigate('register')">إنشاء حساب جديد</button>
          <div style="text-align:center;margin-top:16px">
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('landing')">العودة للرئيسية</button>
          </div>
        </div>
      </div>`;
  },

  async handleLogin() {
    const phone = document.getElementById('login-phone').value.trim();
    if (!phone) return this.toast('الرجاء إدخال رقم الهاتف', 'error');

    const pinGroup = document.getElementById('pin-group');
    const pinInput = document.getElementById('login-pin');
    const isPinVisible = pinGroup && !pinGroup.classList.contains('hidden');
    const pin = isPinVisible ? pinInput.value.trim() : null;

    if (isPinVisible && !pin) return this.toast('الرجاء إدخال رمز الدخول', 'error');

    const result = await Auth.login(phone, pin);

    if (result.success) {
      this.toast(`مرحباً، ${result.user.name}`);
      this.navigate('home');
    } else if (result.require_pin) {
      if (pinGroup) {
        document.getElementById('login-phone').disabled = true;
        pinGroup.classList.remove('hidden');
        pinInput.focus();
      }
    } else {
      // err.message is already translated to Arabic by apiClient → Errors.t.
      // The server intentionally returns a single generic credentials message so
      // attackers can't probe which phones exist (see backend/routes/auth.js).
      this.toast(result.error || 'فشل تسجيل الدخول', 'error');
      const phoneInput = document.getElementById('login-phone');
      if (phoneInput) phoneInput.disabled = false;
    }
  },

  // ─────────────────────────────────────────────────────────
  // REGISTER
  // ─────────────────────────────────────────────────────────
  async renderRegister() {
    const view = this._show('view-register');
    // Pull a fresh list from the server (donor may not be logged in yet, so local
    // cache is empty). The endpoint is public; if it fails, fall back to cache.
    await DB.refreshGroups();
    const groups = DB.getAllGroupsList();
    view.innerHTML = `
      <div class="auth-page">
        <div class="auth-card fade-up">
          <div class="auth-card-top">
            <div class="auth-card-logo" style="background:var(--gold)">${Icons.heart}</div>
            <h3>انضم كمتبرع</h3>
            <p class="text-muted" style="font-size:.9rem;margin-top:4px">سجّل بياناتك للانضمام لمجموعة</p>
          </div>
          <div class="form-group">
            <label class="form-label">الاسم الكامل</label>
            <input type="text" id="reg-name" class="form-input" placeholder="اسمك الكريم" autocomplete="name" enterkeyhint="next">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="tel" id="reg-phone" class="form-input" placeholder="07xxxxxxxxx" autocomplete="tel" inputmode="tel" dir="ltr" style="text-align:center">
          </div>
          <div class="form-group">
            <label class="form-label">المجموعة الجامعية</label>
            <select id="reg-group" class="form-input form-select" onchange="App._updateRegCollectors()">
              <option value="">— اختر مجموعة —</option>
              ${groups.map(g=>`<option value="${g.id}">${this.esc(g.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="reg-collector-group" style="display:none">
            <label class="form-label">مسؤول الجمع (اختياري)</label>
            <select id="reg-collector" class="form-input form-select">
              <option value="">— بدون تعيين —</option>
            </select>
            <div class="form-hint">يمكنك تسليم تبرعك لأي مسؤول آخر في حال غياب مسؤولك.</div>
          </div>
          <div class="form-group">
            <label class="form-label">مبلغ التبرع الشهري (د.ع)</label>
            <select id="reg-amount" class="form-input form-select" dir="ltr" style="text-align:center">
              <option value="250">250</option>
              <option value="1000">1,000</option>
              <option value="5000" selected>5,000</option>
              <option value="10000">10,000</option>
              <option value="15000">15,000</option>
              <option value="25000">25,000</option>
              <option value="50000">50,000</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--primary-bg);padding:12px;border-radius:var(--r-md)">
            <div>
              <div style="font-weight:700;font-size:.9rem;color:var(--primary-dark)">أتبرع كفاعل خير</div>
              <div class="text-xs text-muted">سيظهر اسمك كـ "فاعل خير" عند سداد التبرع</div>
            </div>
            <label class="toggle"><input type="checkbox" id="reg-is-anonymous"><span class="toggle-slider"></span></label>
          </div>
          <button class="btn btn-primary w-full btn-lg" style="margin-top:16px" data-primary onclick="App.handleRegister()">إنشاء الحساب</button>
          <div style="text-align:center;margin-top:12px">
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('login')">لديك حساب؟ سجّل دخول</button>
          </div>
        </div>
      </div>`;
  },

  _updateRegCollectors() {
    const groupId = document.getElementById('reg-group').value;
    const colGroup = document.getElementById('reg-collector-group');
    const colSelect = document.getElementById('reg-collector');
    if (!groupId) { colGroup.style.display = 'none'; return; }
    let collectors = DB.getCollectorsByGroup(groupId);
    if (!collectors.length) collectors = DB.getGroup(groupId)?.collectors || [];
    colGroup.style.display = collectors.length > 0 ? '' : 'none';
    colSelect.innerHTML = '<option value="">— بدون تعيين —</option>' +
      collectors.map(c => `<option value="${c.id}">${App.esc(c.name)}</option>`).join('');
  },

  async handleRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const groupId = document.getElementById('reg-group').value;
    const amount = parseInt(document.getElementById('reg-amount').value) || 5000;
    const isAnonymous = document.getElementById('reg-is-anonymous').checked;
    const colSelectEl = document.getElementById('reg-collector');
    const collectorId = colSelectEl ? colSelectEl.value || null : null;
    if (!name || !phone || !groupId) return this.toast('الرجاء ملء جميع الحقول', 'error');
    if (name.length < 2) return this.toast('الاسم يجب أن يكون حرفين على الأقل', 'error');
    try {
      await Auth.registerDonor({ name, phone, groupId, amount, isAnonymous, collectorId });
      this.toast('تم التسجيل بنجاح');
      this.navigate('home');
    } catch (err) {
      this.toast(err.message || 'فشل التسجيل', 'error');
    }
  },

  // ─────────────────────────────────────────────────────────
  // HOME DASHBOARD
  // ─────────────────────────────────────────────────────────
  renderHome() {
    const view = this._show('view-home');
    const user = Auth.currentUser();
    if (!user) return this.navigate('landing');

    if (user.role === 'superadmin') {
      return this.renderSuperAdminHome();
    }

    const group = DB.getGroup(user.groupId);
    if (!group) return this.navigate('landing');

    const curMonth = DB.getCurrentMonthKey();
    const stats    = DB.getMonthlyStats(group.id, curMonth);
    const orphans  = DB.getOrphansByGroup(group.id);
    const impact   = orphans.length;
    const roleLabel= {superadmin:'المدير العام', admin:'مسؤول المجموعة', collector:'جامع التبرعات', donor:'متبرع'}[user.role]||'';

    let roleCard = '';
    if (user.role === 'donor') {
      const streak  = DB.getDonorStreak(group.id, user.id);
      const myStatus = DB.getDonationStatus(group.id, curMonth, user.id);
      const paid     = myStatus?.paid;
      roleCard = `
        <div class="card fade-up delay-3" style="margin-bottom:16px">
          <h4 style="margin-bottom:16px">حالة تبرعي — ${DB.getMonthLabel(curMonth)}</h4>
          <div style="display:flex;align-items:center;gap:16px;padding:16px;background:${paid?'var(--success-bg)':'var(--gray-50)'};border-radius:var(--r-md)">
            <div style="width:48px;height:48px;border-radius:50%;background:${paid?'var(--success)':'var(--gray-300)'};display:flex;align-items:center;justify-content:center;color:white;flex-shrink:0">${Icons.check}</div>
            <div>
              <div style="font-weight:700;color:${paid?'var(--success)':'var(--text-muted)'}">${paid?'تم التبرع بنجاح':'لم يتم التبرع بعد'}</div>
              <div class="text-sm text-muted">${paid?`المبلغ: ${this.fmt(myStatus.amount)} د.ع`:`المطلوب: ${this.fmt(user.amount||5000)} د.ع`}</div>
            </div>
            ${streak>0?`<div style="margin-right:auto;background:linear-gradient(135deg,#FF6B35,#F7C948);color:white;padding:6px 14px;border-radius:999px;font-size:.8rem;font-weight:700">${streak} شهر متواصل</div>`:''}
          </div>
        </div>`;
    } else if (user.role === 'collector') {
      const myDonors = DB.getUsersByCollector(user.id);
      const paid = myDonors.filter(d => DB.getDonationStatus(group.id,curMonth,d.id)?.paid).length;
      const pct  = myDonors.length ? Math.round(paid/myDonors.length*100) : 0;
      roleCard = `
        <div class="card fade-up delay-3" style="margin-bottom:16px">
          <div class="flex-between" style="margin-bottom:12px">
            <h4>متبرعوي — ${DB.getMonthLabel(curMonth)}</h4>
            <span class="badge ${pct===100?'badge-success':'badge-warning'}">${pct}%</span>
          </div>
          <div class="flex-between text-sm text-muted" style="margin-bottom:8px">
            <span>${paid} متبرع من أصل ${myDonors.length}</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
          <div style="margin-top:16px;display:flex;gap:10px">
            <button class="btn btn-primary btn-sm" onclick="App.navigate('grid')">إدارة التبرعات</button>
            <button class="btn btn-outline btn-sm" onclick="App.showSendReminderModal()">إرسال تذكير</button>
          </div>
        </div>`;
    } else if (user.role === 'admin' || user.role === 'superadmin') {
      const dbCollectors = DB.getCollectorsByGroup(group.id);
      let colsHtml = '';
      if (dbCollectors.length === 0) {
        colsHtml = `<p class="text-muted text-sm" style="margin-bottom:12px">لا يوجد مسؤولي جمع حتى الآن.</p>`;
      } else {
        colsHtml = dbCollectors.map(c => {
          const cDonors = DB.getUsersByCollector(c.id);
          const cPaid = cDonors.filter(d => DB.getDonationStatus(group.id, curMonth, d.id)?.paid).length;
          const cPct = cDonors.length ? Math.round(cPaid / cDonors.length * 100) : 0;
          return `
            <div style="margin-bottom:12px">
              <div class="flex-between text-sm" style="margin-bottom:4px">
                <span style="font-weight:600">${this.esc(c.name)}</span>
                <span style="color:var(--primary);font-weight:700">${cPaid}/${cDonors.length}</span>
              </div>
              <div class="progress" style="height:6px;background:var(--border)"><div class="progress-bar" style="width:${cPct}%"></div></div>
            </div>`;
        }).join('');
      }
      roleCard = `
        <div class="card fade-up delay-3" style="margin-bottom:16px;border-top:3px solid var(--primary)">
          <div class="flex-between" style="margin-bottom:16px">
            <h4>لوحة إدارة الحملة</h4>
            <span class="badge badge-primary">${DB.getMonthLabel(curMonth)}</span>
          </div>
          <div style="margin-bottom:12px;font-weight:700;font-size:.9rem;color:var(--text-muted)">أداء مسؤولي الجمع</div>
          ${colsHtml}
          <div style="margin-top:16px;display:flex;gap:10px">
            <button class="btn btn-primary w-full" style="flex:1" onclick="App.navigate('collectors')">مشاهدة المسؤولين</button>
            <button class="btn btn-outline w-full" style="flex:1" onclick="App.navigate('grid')">سجل المتبرعين (${stats.totalDonors})</button>
          </div>
        </div>`;
    }

    const anns = DB.getAnnouncementsByGroup(group.id).slice(0,2);

    let atRiskHtml = '';
    if (user.role === 'admin' || user.role === 'superadmin' || user.role === 'collector') {
      const atRisk = DB.getAtRiskDonors(group.id, user.role === 'collector' ? user.id : null);
      if (atRisk.length > 0) {
        atRiskHtml = `
          <div class="card fade-up delay-2" style="margin-bottom:16px;background:var(--error-bg);border:1px solid var(--error)">
            <div style="display:flex;align-items:center;gap:8px;color:var(--error);font-weight:700;margin-bottom:8px">
              <span class="icon icon-sm">${Icons.bell}</span> متأخرون عن الدفع (${atRisk.length} متبرع)
            </div>
            <div class="text-sm" style="color:var(--error-dark);margin-bottom:12px">
              دفع هؤلاء المتبرعون الشهر الماضي وتجاوزوا فترة السماح (اليوم الخامس) دون الدفع لهذا الشهر.
            </div>
            <button class="btn w-full btn-sm" style="background:var(--surface);color:var(--error);border:1px solid var(--error);padding:6px;font-size:.8rem;font-weight:700" onclick="App._gridFilterStatus='unpaid'; App.navigate('grid')">
              مراجعة جدول المتبرعين للاتصال بهم
            </button>
          </div>
        `;
      }
    }

    view.innerHTML = `
      <div class="container">
        <div class="card fade-up" style="margin-bottom:16px;background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%);border:none;color:white;cursor:pointer" onclick="App.navigate('profile')">
          <div style="display:flex;align-items:center;gap:14px;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:14px">
              <div class="avatar avatar-lg" style="background:rgba(255,255,255,.2);color:white;border-color:rgba(255,255,255,.3);font-size:1.1rem;font-weight:800">${user.name?this.esc(user.name[0]):'م'}</div>
              <div>
                <div style="font-size:.8125rem;opacity:.8;font-weight:500">مرحباً</div>
                <div style="font-size:1.2rem;font-weight:800">${this.esc(user.name)}</div>
                <div style="font-size:.8125rem;opacity:.8">${this.esc(group.name)} &nbsp;·&nbsp; ${roleLabel}</div>
              </div>
            </div>
            <div style="background:rgba(255,255,255,.2);padding:6px 10px;border-radius:var(--r-sm);font-size:.8rem;font-weight:700">
              إعدادات حسابي ${Icons.user}
            </div>
          </div>
        </div>

        <div class="stats-grid fade-up delay-1">
          <div class="stat-card">
            <div class="stat-icon">${Icons.users}</div>
            <span class="stat-value">${this.fmt(stats.paidCount)}<span style="font-size:1rem;color:var(--text-muted)">/${this.fmt(stats.totalDonors)}</span></span>
            <span class="stat-label">تبرعوا هذا الشهر</span>
          </div>
          <div class="stat-card accent-gold">
            <div class="stat-icon">${Icons.wallet}</div>
            <span class="stat-value">${this.fmt(stats.totalAmount)}</span>
            <span class="stat-label">دينار تم جمعه</span>
          </div>
          <div class="stat-card" style="cursor:pointer" onclick="App.navigate('orphans')">
            <div class="stat-icon">${Icons.baby}</div>
            <span class="stat-value">${this.fmt(impact)}</span>
            <span class="stat-label">يتيم مكفول</span>
          </div>
          <div class="stat-card accent-gold">
            <div class="stat-icon">${Icons.chart}</div>
            <span class="stat-value">${stats.completionRate}%</span>
            <span class="stat-label">نسبة الإنجاز</span>
          </div>
        </div>

        <div class="card fade-up delay-2" style="margin-bottom:16px">
          <div class="flex-between" style="margin-bottom:10px">
            <h4>تقدم الشهر الحالي</h4>
            <span class="badge badge-primary">${DB.getMonthLabel(curMonth)}</span>
          </div>
          <div class="flex-between text-sm text-muted" style="margin-bottom:8px">
            <span>الهدف (التعهدات): ${this.fmt(stats.totalExpected)} د.ع</span>
            <span style="font-weight:700;color:var(--primary)">${stats.completionRate}%</span>
          </div>
          <div class="progress" style="height:10px"><div class="progress-bar" style="width:${stats.completionRate}%"></div></div>
          <div class="flex-between" style="margin-top:8px;font-size:.8125rem">
            <span class="text-muted">تم جمع: ${this.fmt(stats.totalAmount)} د.ع</span>
            <span class="text-muted">المتبقي من التعهدات: ${this.fmt(Math.max(0, stats.totalExpected - stats.totalAmount))} د.ع</span>
          </div>
        </div>

        ${(!user.telegramChatId && user.role === 'donor' && group?.botUsername) ? `
        <div class="card fade-up delay-2" style="margin-bottom:16px;background:rgba(212,167,44,.1);border:1px solid var(--gold);display:flex;align-items:center;gap:12px;cursor:pointer" onclick="App.navigate('profile')">
          <div style="background:var(--gold);color:white;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">${Icons.telegram}</div>
          <div style="flex:1">
            <div style="font-weight:700;color:var(--text-heading);font-size:.9rem">اربط حسابك بالتليجرام</div>
            <div class="text-xs text-muted">اضغط هنا لتفعيل الإشعارات والتذكيرات الآلية</div>
          </div>
          <span style="color:var(--gold)">${Icons.back}</span>
        </div>` : ''}

        ${atRiskHtml}
        ${roleCard}

        <div class="section-header fade-up delay-3">
          <h4 class="section-title">آخر الأخبار</h4>
          <button class="btn btn-ghost btn-sm" onclick="App.navigate('news')">عرض الكل</button>
        </div>
        ${anns.length ? anns.map(a => this._annCard(a)).join('') : '<p class="text-muted text-center" style="padding:20px">لا توجد أخبار</p>'}
      </div>`;
  },

  // ─────────────────────────────────────────────────────────────
  // NEW: SUPER ADMIN HOME
  // ─────────────────────────────────────────────────────────────
  renderSuperAdminHome() {
    const view = this._show('view-home');
    const groups = DB.getAllGroupsList();
    const curMonth = DB.getCurrentMonthKey();

    let totalDonors = 0, totalPaid = 0, totalAmount = 0;
    const groupCards = groups.map(g => {
      const stats = DB.getMonthlyStats(g.id, curMonth);
      totalDonors += stats.totalDonors;
      totalPaid += stats.paidCount;
      totalAmount += stats.totalAmount;
      return `
        <div class="card card-hover" style="margin-bottom:12px;cursor:pointer;border-right:4px solid var(--primary);position:relative"
             onclick="App.superAdminViewGroup('${g.id}')">
          <button class="icon-btn" title="إعدادات الحملة" aria-label="إعدادات الحملة: ${this.esc(g.name)}"
                  onclick="event.stopPropagation(); App.showCampaignSettingsModal('${g.id}')"
                  style="position:absolute;top:6px;left:6px">
            ${Icons.settings}
          </button>
          <div class="flex-between" style="margin-bottom:10px">
            <div>
              <div class="font-bold" style="font-size:1rem;color:var(--text-heading)">${this.esc(g.name)}</div>
              <div class="text-sm text-muted" style="margin-top:3px">${this.esc(g.university)} &nbsp;·&nbsp; <span style="cursor:pointer;color:var(--primary)" onclick="event.stopPropagation(); App._superAdminActiveGroup = '${g.id}'; App.navigate('orphans')">${DB.getOrphansByGroup(g.id).length} يتيم مكفول</span></div>
            </div>
            <span class="badge ${stats.completionRate>=100?'badge-success':'badge-primary'}">${stats.completionRate}%</span>
          </div>
          <div class="progress" style="height:6px;margin-bottom:10px"><div class="progress-bar" style="width:${stats.completionRate}%"></div></div>
          <div class="flex-between text-sm text-muted">
            <span>متبرعون سددوا: <strong style="color:var(--text-body)">${this.fmt(stats.paidCount)} من ${this.fmt(stats.totalDonors)}</strong></span>
            <span style="font-weight:700;color:var(--primary)">${this.fmt(stats.totalAmount)} د.ع</span>
          </div>
        </div>`;
    }).join('');

    view.innerHTML = `
      <div class="container pb-nav">
        <div class="card fade-up" style="margin-bottom:20px;background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%);border:none;color:white">
          <div class="flex-between" style="margin-bottom:12px;align-items:flex-start">
            <div>
              <div style="font-size:.875rem;opacity:.85;margin-bottom:4px;display:flex;align-items:center;gap:4px">مرحباً ${this.esc((Auth.currentUser()?.name || '').split(' ')[0])} <span class="icon icon-sm">${Icons.handwave}</span></div>
              <h2 style="color:white;font-size:1.5rem;margin:0">لوحة المدير العام</h2>
            </div>
            <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:.75rem;font-weight:700">المدير العام</span>
          </div>
          <p style="color:rgba(255,255,255,.9);font-size:.95rem;margin:0">إشراف شامل على جميع الحملات الخيرية</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
          <div class="stat-card fade-up delay-1">
            <div class="stat-icon">${Icons.shield}</div>
            <span class="stat-value">${this.fmt(groups.length)}</span>
            <span class="stat-label">حملات نشطة</span>
          </div>
          <div class="stat-card fade-up delay-2">
            <div class="stat-icon">${Icons.users}</div>
            <span class="stat-value">${this.fmt(totalPaid)}<span class="unit">من ${this.fmt(totalDonors)}</span></span>
            <span class="stat-label">متبرع دفع هذا الشهر</span>
          </div>
          <div class="stat-card accent-gold fade-up delay-3" style="grid-column:1 / -1">
            <div class="stat-icon">${Icons.wallet}</div>
            <span class="stat-value">${this.fmt(totalAmount)}<span class="unit">د.ع</span></span>
            <span class="stat-label">مجموع التبرعات — ${DB.getMonthLabel(curMonth)}</span>
          </div>
        </div>

        <div class="section-header fade-up delay-3">
          <h4 class="section-title">جميع الحملات</h4>
          <button class="btn btn-primary btn-sm" onclick="App.showSuperAdminCreateCampaignModal()">
            <span class="icon icon-sm">${Icons.plus}</span> إضافة حملة
          </button>
        </div>
        <div class="fade-up delay-3">
          ${groupCards}
        </div>
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // DONATION GRID
  // ─────────────────────────────────────────────────────────
  _renderNoGroup(view) {
    view.innerHTML = `
      <div class="container pb-nav">
        <div class="empty-state">
          <div class="empty-icon">${Icons.news}</div>
          <div class="empty-title">لا توجد حملة بعد</div>
          <div class="empty-desc">أنشئ حملة من لوحة المدير العام أولاً</div>
          <button class="btn btn-primary" style="margin-top:12px" onclick="App.navigate('home')">الرئيسية</button>
        </div>
      </div>`;
  },

  renderGrid() {
    const view = this._show('view-grid');
    const user  = Auth.currentUser();
    if (!user) return this.navigate('landing');
    
    const effectiveGroupId = this._getEffectiveGroupId();
    const group   = DB.getGroup(effectiveGroupId);
    if (!group) return this._renderNoGroup(view);

    const months  = DB.getRecentMonths(6);
    const canEdit = Auth.canManageDonations();
    
    let dbDonors = user.role==='collector' ? DB.getUsersByCollector(user.id) : DB.getDonorsByGroup(effectiveGroupId);
    if (this._gridFilterCollectorId && this._gridFilterCollectorId !== 'ALL') {
      dbDonors = dbDonors.filter(d => d.collectorId === this._gridFilterCollectorId);
    }
    if (this._gridFilterStatus && user.role !== 'donor') {
      const curM = months[0];
      dbDonors = dbDonors.filter(d => {
        const s = DB.getDonationStatus(group.id, curM, d.id);
        return this._gridFilterStatus === 'paid' ? !!s?.paid : !s?.paid;
      });
    }
    const donors = dbDonors;

    const rows = donors.map(d => {
      const curMonth = months[0];
      const status = DB.getDonationStatus(group.id, curMonth, d.id);
      const isPaidThisMonth = status?.paid;
      
      let displayName = d.name;
      // Staff (collector/admin/superadmin) ALWAYS see the real name.
      // Only fellow donors see "فاعل خير" when the donor has opted-in and paid.
      const isViewer = user.role === 'donor';
      if (isViewer && ((d.isAnonymous && isPaidThisMonth) || d.name === 'فاعل خير')) {
        displayName = 'فاعل خير';
      }

      const colName = ((user.role === 'admin' || user.role === 'superadmin') && d.collectorId) ? (DB.getUser(d.collectorId)?.name || '') : '';
      const colBadge = colName ? `<div class="text-xs" style="color:var(--primary);margin-top:3px;font-weight:600">مسؤول: ${this.esc(colName)}</div>` : '';

      // If unpaid, show a "How to pay" link
      let payAction = '';
      if (!isPaidThisMonth) {
        payAction = `
          <div>
            <button class="btn btn-ghost btn-xs pay-link" onclick="App.showPayWindow('${d.id}')">
              ${Icons.wallet} طريقة السداد
            </button>
          </div>`;
      }

      const cells = months.map((m, mi) => {
        const cur = mi === 0 ? 'is-current' : '';
        const s = DB.getDonationStatus(group.id, m, d.id);
        const paid = s?.paid;
        const cellHtml = paid
          ? `<div class="check-icon paid">${Icons.check}</div>`
          : `<div class="check-icon unpaid">${Icons.circle}</div>`;
        
        // Use real name in the confirmation title even if anonymous (for admins)
        const titleName = (canEdit) ? d.name : displayName;

        return canEdit
          ? `<td class="cell-action ${cur}" onclick="App.toggleDonation('${group.id}','${m}','${d.id}',${d.amount||5000})" title="${paid?'إلغاء':'تأكيد تبرع'} ${this.esc(titleName)}" aria-label="${paid?'إلغاء تبرع':'تأكيد تبرع'} ${this.esc(titleName)} — ${DB.getMonthLabel(m)}">${cellHtml}</td>`
          : `<td class="${cur}">${cellHtml}</td>`;
      }).join('');

      const isSelf = user.role === 'donor' && d.id === user.id;
      const nameShown = isSelf ? d.name : displayName;
      return `<tr class="${isSelf ? 'row-self' : ''}"><td><div class="donor-cell-name">${this.esc(nameShown)}${isSelf ? '<span class="self-badge">أنت</span>' : ''}</div>${colBadge}${payAction}<div class="text-xs text-muted donor-cell-amount" style="margin-top:2px">${this.fmt(d.amount||5000)} د.ع</div></td>${cells}</tr>`;
    }).join('');

    let headerControls = '';
    if (user.role === 'admin' || user.role === 'superadmin') {
      const dbCollectors = DB.getCollectorsByGroup(effectiveGroupId);
      const options = dbCollectors.map(c => `<option value="${c.id}" ${this._gridFilterCollectorId===c.id?'selected':''}>${this.esc(c.name)}</option>`).join('');
      headerControls = `
        <div style="display:flex;gap:8px;margin-top:12px;margin-bottom:16px">
          <select class="form-input" style="flex:1;padding:4px 12px;cursor:pointer;font-weight:600" onchange="App._gridFilterCollectorId = this.value; App.renderGrid()">
            <option value="ALL">جميع المتبرعين (${DB.getDonorsByGroup(effectiveGroupId).length})</option>
            ${options}
          </select>
          <button class="btn btn-outline btn-sm" onclick="App.exportGridToCSV()">
            <span class="icon icon-sm">${Icons.download}</span> Excel (CSV)
          </button>
        </div>
      `;
    }

    let groupPickerHtml = '';
    if (user.role === 'superadmin') {
      const allGroups = DB.getAllGroupsList();
      groupPickerHtml = `
        <div style="margin-bottom:16px">
          <label class="form-label text-sm text-muted" style="display:block;margin-bottom:4px">اختر الحملة (للمدير العام):</label>
          <select class="form-input form-select" onchange="App.superAdminViewGroup(this.value)">
            ${allGroups.map(g => `<option value="${g.id}" ${g.id===effectiveGroupId?'selected':''}>${this.esc(g.name)}</option>`).join('')}
          </select>
        </div>`;
    }

    view.innerHTML = `
      <div class="container">
        <div class="section-header" style="${user.role==='admin' || user.role==='superadmin' ? 'margin-bottom:0' : ''}">
          <h3 class="section-title">جدول التبرعات</h3>
          ${canEdit ? `<button class="btn btn-primary btn-sm" onclick="App.showAddDonorModal()"><span class="icon icon-sm">${Icons.plus}</span> إضافة متبرع</button>` : ''}
        </div>
        ${groupPickerHtml}
        ${headerControls}

        <div class="month-pills" style="margin-bottom:16px">
          ${months.map((m,i)=>`<button class="month-pill ${i===0?'active':''}" onclick="App._focusMonth(${i})">${DB.getMonthLabel(m)}</button>`).join('')}
        </div>

        ${canEdit?`<div style="background:var(--primary-bg);border-radius:var(--r-md);padding:12px 16px;margin-bottom:16px;font-size:.875rem;color:var(--primary-dark)">اضغط على أي خلية لتغيير حالة التبرع</div>`:''}

        <div class="donation-grid-wrapper">
          <table class="donation-grid">
            <thead><tr>
              <th>المتبرع</th>
              ${months.map((m,i)=>{ const [monthName, year] = DB.getMonthLabel(m).split(' ');
                return `<th class="${i===0?'is-current':''}" data-month="${i}" scope="col"><span class="mh-month">${monthName}</span><span class="mh-year">${year}</span></th>`; }).join('')}
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="${months.length+1}" style="text-align:center;padding:40px;color:var(--text-muted)">لا يوجد متبرعون</td></tr>`}</tbody>
          </table>
        </div>

        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          ${user.role !== 'donor' ? (() => {
            const pA = this._gridFilterStatus === 'paid';
            const uA = this._gridFilterStatus === 'unpaid';
            return `
          <button onclick="App._toggleGridFilter('paid')" style="display:flex;align-items:center;gap:7px;padding:6px 14px;border-radius:999px;cursor:pointer;border:2px solid ${pA?'var(--success)':'var(--border)'};background:${pA?'var(--success-bg)':'var(--surface)'};opacity:${uA?'0.35':'1'};font-size:.8rem;font-weight:${pA?'700':'500'};transition:opacity .15s,border-color .15s,background .15s">
            <div class="check-icon paid" style="width:18px;height:18px">${Icons.check}</div>
            <span style="color:${pA?'var(--success)':'var(--text-body)'}">تبرّع</span>
          </button>
          <button onclick="App._toggleGridFilter('unpaid')" style="display:flex;align-items:center;gap:7px;padding:6px 14px;border-radius:999px;cursor:pointer;border:2px solid ${uA?'var(--danger)':'var(--border)'};background:${uA?'var(--danger-bg)':'var(--surface)'};opacity:${pA?'0.35':'1'};font-size:.8rem;font-weight:${uA?'700':'500'};transition:opacity .15s,border-color .15s,background .15s">
            <div class="check-icon unpaid" style="width:18px;height:18px">${Icons.circle}</div>
            <span style="color:${uA?'var(--danger)':'var(--text-body)'}">لم يتبرع بعد</span>
          </button>`;
          })() : `
          <div style="display:flex;align-items:center;gap:7px;font-size:.8rem"><div class="check-icon paid" style="width:18px;height:18px">${Icons.check}</div> تبرّع</div>
          <div style="display:flex;align-items:center;gap:7px;font-size:.8rem"><div class="check-icon unpaid" style="width:18px;height:18px">${Icons.circle}</div> لم يتبرع بعد</div>`}
        </div>
      </div>`;
  },

  exportGridToCSV() {
    const user = Auth.currentUser();
    const effectiveGroupId = this._getEffectiveGroupId();
    const group = DB.getGroup(effectiveGroupId);
    const curMonth = DB.getCurrentMonthKey();
    let donors = user.role === 'collector' ? DB.getUsersByCollector(user.id) : DB.getDonorsByGroup(group.id);
    
    if (this._gridFilterCollectorId && this._gridFilterCollectorId !== 'ALL') {
      donors = donors.filter(d => d.collectorId === this._gridFilterCollectorId);
    }

    let csv = '\uFEFF'; // BOM for Excel Arabic support
    csv += 'الاسم,رقم الهاتف,المسؤول,حالة الدفع (هذا الشهر),المبلغ\n';
    
    donors.forEach(d => {
      const name = d.name;
      const phone = d.phone || '';
      const colName = d.collectorId ? (DB.getUser(d.collectorId)?.name || '') : '';
      const status = DB.getDonationStatus(group.id, curMonth, d.id)?.paid ? 'مدفوع' : 'غير مدفوع';
      const amount = d.amount || 5000;
      csv += `"${name}","${phone}","${colName}","${status}","${amount}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `تبرعات_${DB.getMonthLabel(curMonth)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  _toggleGridFilter(status) {
    this._gridFilterStatus = this._gridFilterStatus === status ? null : status;
    this.renderGrid();
  },

  toggleDonation(groupId, monthKey, userId, amount) {
    const prev = DB.getDonationStatus(groupId, monthKey, userId);
    const paid = prev?.paid;
    DB.setDonationStatus(groupId, monthKey, userId, {
      paid: !paid, amount: !paid ? amount : 0,
      collectorId: Auth.currentUser()?.id,
    });

    // Digital receipt via the bot — sent only after the undo window closes,
    // so an accidental tap that is undone never messages the donor.
    let receiptTimer = null;
    if (!paid) {
      const donor = DB.getUser(userId);
      if (donor && donor.telegramChatId) {
        const collectorName = Auth.currentUser()?.name;
        receiptTimer = setTimeout(() => {
          API.post('/api/send-receipt', {
            chatId: donor.telegramChatId,
            donorName: donor.name,
            amount: amount || 5000,
            month: DB.getMonthLabel(monthKey),
            collectorName,
          }).catch(e => console.log('Receipt skipped:', e));
        }, 5500);
      }
    }

    this.toast(paid ? 'تم إلغاء التبرع' : 'تم تأكيد التبرع', 'success', {
      duration: 5000,
      action: {
        label: 'تراجع',
        onClick: () => {
          clearTimeout(receiptTimer);
          DB.setDonationStatus(groupId, monthKey, userId, prev
            ? { paid: prev.paid, amount: prev.amount, date: prev.date, collectorId: prev.collectorId }
            : { paid: false, amount: 0, collectorId: null });
          if (this.currentView === 'grid') this.renderGrid();
          this.toast('تم التراجع', 'info');
        },
      },
    });

    this.renderGrid();
  },

  showAddDonorModal() {
    const user = Auth.currentUser();
    const effectiveGroupId = this._getEffectiveGroupId();
    const collectors = DB.getCollectorsByGroup(effectiveGroupId);
    let collectorSelect = '';
    
    if ((user.role === 'admin' || user.role === 'superadmin') && collectors.length > 0) {
      collectorSelect = `
        <div class="form-group" style="margin-top:10px">
          <label class="form-label">تعيين مسؤول جمع (اختياري)</label>
          <select id="add-collector-id" class="form-input" style="padding-right:12px;cursor:pointer">
            <option value="">-- بدون تعيين --</option>
            ${collectors.map(c => `<option value="${c.id}">${this.esc(c.name)}</option>`).join('')}
          </select>
        </div>
      `;
    }

    this._openModal(`
      <div class="modal-header"><div class="modal-title">إضافة متبرع جديد</div></div>
      <div class="form-group">
        <label class="form-label">الاسم الكامل</label>
        <input type="text" id="add-name" class="form-input" placeholder="اسم المتبرع">
      </div>
      <div class="form-group">
        <label class="form-label">رقم الهاتف</label>
        <input type="tel" id="add-phone" class="form-input" placeholder="07xxxxxxxxx" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ التبرع الشهري (د.ع)</label>
        <input type="number" inputmode="numeric" id="add-amount" class="form-input" value="5000" min="1000" step="1000" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;margin-bottom:12px;background:var(--primary-bg);padding:10px;border-radius:var(--r-md)">
        <div>
          <div style="font-weight:700;font-size:.9rem;color:var(--primary-dark)">تبرع كفاعل خير</div>
          <div class="text-xs text-muted">سيظهر الاسم كـ "فاعل خير" عند سداد التبرع</div>
        </div>
        <label class="toggle"><input type="checkbox" id="add-is-anonymous"><span class="toggle-slider"></span></label>
      </div>
      ${collectorSelect}
      <button class="btn btn-primary w-full" style="margin-top:8px" onclick="App.handleAddDonor()">إضافة المتبرع</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  async handleAddDonor() {
    const name   = document.getElementById('add-name').value.trim();
    const phone  = document.getElementById('add-phone').value.trim();
    const amount = parseInt(document.getElementById('add-amount').value) || 5000;
    const user   = Auth.currentUser();
    if (!name || !phone) return this.toast('الرجاء ملء الحقول المطلوبة', 'error');

    let collectorId = user.role === 'collector' ? user.id : null;
    const colSelect = document.getElementById('add-collector-id');
    if (colSelect && colSelect.value) collectorId = colSelect.value;

    const isAnonymous = document.getElementById('add-is-anonymous').checked;
    const effectiveGroupId = this._getEffectiveGroupId();

    try {
      const { user: donor, linked } = await Auth.addDonor({
        name, phone, amount, isAnonymous, collectorId,
        groupId: user.role === 'superadmin' ? effectiveGroupId : undefined,
      });
      // Notify via Telegram if the linked donor has it connected
      if (linked && donor.telegramChatId) {
        const collector = DB.getUser(donor.collectorId);
        const msg = `مرحباً ${donor.name}،\n\nتم إضافتك إلى قائمة المتبرعين التابعة لمسؤول الجمع: ${collector?.name || 'غير محدد'}.\nإدارة تطبيق ومن أحياها`;
        API.post('/api/send-reminders', { messages: [{ chatId: donor.telegramChatId, text: msg }] }).catch(() => {});
      }
      this.closeModal();
      this.toast(linked ? `تم ربط ${donor.name} بهذا المسؤول ✓` : 'تمت إضافة المتبرع');
    } catch (err) {
      this.toast(err.message || 'فشل إضافة المتبرع', 'error');
      return;
    }
    this.renderGrid();
  },

  showPayWindow(donorId) {
    const donor = DB.getUser(donorId);
    if (!donor) return;
    const collector = DB.getUser(donor.collectorId);
    const month = DB.getMonthLabel(DB.getCurrentMonthKey());
    
    let collectorInfo = '';
    if (collector) {
      collectorInfo = `
        <div class="card" style="margin-top:16px;background:var(--primary-bg);border:1px solid var(--primary)">
          <div style="font-weight:700;color:var(--primary);margin-bottom:8px">مسؤول الجمع الخاص بك:</div>
          <div style="display:flex;align-items:center;gap:12px">
            <div class="avatar avatar-md" style="background:var(--primary);color:white">${this.esc(collector.name[0])}</div>
            <div>
              <div style="font-weight:700">${this.esc(collector.name)}</div>
              <div class="text-sm text-muted">${collector.phone || 'لا يوجد رقم'}</div>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <a href="tel:${collector.phone}" class="btn btn-primary btn-sm" style="flex:1;justify-content:center">اتصال</a>
            <a href="https://wa.me/${App.intlPhone(collector.phone)}" target="_blank" class="btn btn-outline btn-sm" style="flex:1;justify-content:center;color:#25D366;border-color:#25D366">واتساب</a>
          </div>
        </div>
      `;
    }

    this._openModal(`
      <div class="modal-header">
        <div class="modal-title">طريقة سداد التبرع</div>
      </div>
      <div class="text-center" style="margin-bottom:16px">
        <div style="font-size:2rem;margin-bottom:8px">💸</div>
        <div style="font-weight:700;font-size:1.1rem">تبرع شهر ${month}</div>
        <div class="text-sm text-muted">المبلغ المطلوب: ${this.fmt(donor.amount||5000)} د.ع</div>
      </div>
      <p class="text-sm text-muted" style="line-height:1.6">يرجى تسليم مبلغ التبرع إلى مسؤول الجمع الخاص بك لتأكيد السداد في الجدول. عند الاستلام، سيقوم المسؤول بتفعيل العلامة الخضراء أمام اسمك.</p>
      ${collectorInfo}
      <button class="btn btn-ghost w-full" style="margin-top:16px" onclick="App.closeModal()">إغلاق</button>
    `);
  },

  // ─── Cross-Collector Pay Report ───────────────────────────
  showPayReportModal() {
    const user = Auth.currentUser();
    const effectiveGroupId = this._getEffectiveGroupId();
    const allDonors = DB.getDonorsByGroup(effectiveGroupId);

    const donorOptions = allDonors
      .filter(d => d.collectorId !== user.id) // exclude own donors
      .map(d => `<option value="${d.id}">${this.esc(d.name)} — ${this.fmt(d.amount||5000)} د.ع</option>`)
      .join('');

    this._openModal(`
      <div class="modal-header">
        <div class="modal-title">بلاغ استلام تبرع</div>
      </div>
      <p class="text-sm text-muted" style="margin-bottom:16px;line-height:1.6">استلمت تبرعاً من متبرع ليس في قائمتك. أدخل تفاصيله ليتمكن مسؤوله من تأكيد الاستلام.</p>
      <div class="form-group">
        <label class="form-label">المتبرع</label>
        <select id="prd-donor" class="form-input form-select">
          <option value="">— اختر المتبرع —</option>
          ${donorOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">المبلغ المستلم (د.ع)</label>
        <input type="number" inputmode="numeric" id="prd-amount" class="form-input" value="5000" min="250" step="250" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظة (اختياري)</label>
        <input type="text" id="prd-note" class="form-input" placeholder="مثلاً: دُفع نقداً في الكلية">
      </div>
      <button class="btn btn-primary w-full" onclick="App._submitPayReport()">إرسال البلاغ</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>
    `);
  },

  _submitPayReport() {
    const user     = Auth.currentUser();
    const donorId  = document.getElementById('prd-donor').value;
    const amount   = parseInt(document.getElementById('prd-amount').value) || 5000;
    const note     = document.getElementById('prd-note').value.trim();
    if (!donorId) return this.toast('يرجى اختيار المتبرع', 'error');

    const donor = DB.getUser(donorId);
    DB.savePayReport({
      groupId: this._getEffectiveGroupId(),
      donorId,
      donorName: donor?.name || '؟',
      amount,
      note,
      reportedByCollectorId: user.id,
    });
    this.closeModal();
    this.toast('تم إرسال البلاغ ✓ — سيتلقاه مسؤول المتبرع');
    this.renderCollectors();
  },

  acknowledgePayReport(reportId, donorId) {
    const user  = Auth.currentUser();
    const group = DB.getGroup(this._getEffectiveGroupId());
    const month = DB.getCurrentMonthKey();
    const donor = DB.getUser(donorId);

    // Mark donation as paid in the grid
    if (donor && group) {
      DB.setDonationStatus(group.id, month, donorId, {
        paid: true,
        amount: donor.amount || 5000,
        collectorId: user.id,
        note: 'عبر بلاغ استلام',
      });
    }

    DB.acknowledgePayReport(reportId);
    this.toast('تم التأكيد وتحديث جدول التبرعات ✓');
    this.renderCollectors();
  },

  // Utilities for new UI
  timeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'الآن';
    if (diff < 3600) return `منذ ${Math.floor(diff/60)} د`;
    if (diff < 86400) return `منذ ${Math.floor(diff/3600)} س`;
    return `منذ ${Math.floor(diff/86400)} يوم`;
  },
  // NOTE: second definition removed — using the strict textContent-based esc() at line 12


  // ─────────────────────────────────────────────────────────
  // NEWS — no reminder type shown; separate mechanism
  // ─────────────────────────────────────────────────────────
  renderNews() {
    const view  = this._show('view-news');
    const user  = Auth.currentUser();
    if (!user) return this.navigate('landing');
    
    const effectiveGroupId = this._getEffectiveGroupId();
    const group = DB.getGroup(effectiveGroupId);
    if (!group) return this._renderNoGroup(view);
    const anns  = DB.getAnnouncementsByGroup(group.id).filter(a => a.type !== 'reminder');
    const can   = Auth.canPostAnnouncements();
    const pinnedAnns = anns.filter(a => a.isPinned);
    const regularAnns = anns.filter(a => !a.isPinned);

    view.innerHTML = `
      <div class="container">
        <div class="section-header">
          <h3 class="section-title">الأخبار والإعلانات</h3>
          ${can ? `<button class="btn btn-primary btn-sm" onclick="App.showPostModal()"><span class="icon icon-sm">${Icons.plus}</span> إعلان جديد</button>` : ''}
        </div>
        
        ${pinnedAnns.length > 0 ? `
          <details style="margin-bottom:20px;background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--r-md);padding:12px;cursor:pointer">
            <summary style="font-weight:700;color:var(--warning-dark);outline:none;display:flex;align-items:center;gap:8px">
              <span class="icon icon-sm">${Icons.bookmark}</span> أخبار ومستندات مثبتة (${pinnedAnns.length})
            </summary>
            <div style="margin-top:12px">
              ${pinnedAnns.map(a => this._annCard(a, can)).join('')}
            </div>
          </details>
        ` : ''}

        ${regularAnns.length===0 && pinnedAnns.length===0 ? `
          <div class="empty-state">
            <div class="empty-icon">${Icons.news}</div>
            <div class="empty-title">لا توجد إعلانات</div>
            <div class="empty-desc">لم يتم نشر أي إعلان بعد</div>
          </div>` : regularAnns.map(a => this._annCard(a, can)).join('')}
      </div>`;
  },

  _annCard(a, canDelete = false) {
    const typeLabel = {news:'خبر', availability:'تواجد'}[a.type] || 'إعلان';
    const typeBadge = {news:'badge-primary', availability:'badge-success'}[a.type] || 'badge-gray';
    return `
      <div class="announcement-card type-${a.type||'news'} fade-up">
        <div class="ann-header">
          <div class="avatar avatar-filled" style="font-size:.875rem">${a.authorName?this.esc(a.authorName)[0]:'م'}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:.9375rem">${this.esc(a.authorName)||'مجهول'}</div>
            <div class="ann-meta">${this.timeAgo(a.date)}</div>
          </div>
          <span class="badge ${typeBadge}">${typeLabel}</span>
          ${canDelete ? `
            <div style="display:flex;gap:4px">
              <button class="icon-btn primary" title="تعديل" aria-label="تعديل الإعلان" onclick="event.stopPropagation(); App.showEditAnnouncementModal('${a.id}')">
                ${Icons.edit}
              </button>
              <button class="icon-btn danger" title="حذف" aria-label="حذف الإعلان" onclick="event.stopPropagation(); App.deleteAnnouncement('${a.id}')">
                ${Icons.trash}
              </button>
            </div>` : ''}
        </div>
        ${a.title ? `<div class="ann-title">${this.esc(a.title)}</div>` : ''}
        <div class="ann-body">${this.esc(a.content)}</div>
        ${a.image ? `<img src="${this.esc(a.image.startsWith('/') ? API.BASE + a.image : a.image)}" loading="lazy" style="margin-top:12px;border-radius:var(--r-sm);max-height:300px;object-fit:cover;width:100%" alt="Attachment">` : ''}
      </div>`;
  },

  showPostModal() {
    this._openModal(`
      <div class="modal-header"><div class="modal-title">نشر إعلان</div></div>
      <div class="form-group">
        <label class="form-label">نوع الإعلان</label>
        <select id="post-type" class="form-input form-select">
          <option value="news">خبر عام</option>
          <option value="availability">تحديث تواجد</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">العنوان</label>
        <input type="text" id="post-title" class="form-input" placeholder="عنوان الإعلان">
      </div>
      <div class="form-group">
        <label class="form-label">المحتوى</label>
        <textarea id="post-content" class="form-input" placeholder="اكتب إعلانك هنا..." style="min-height:100px"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">صورة / مرفق (اختياري)</label>
        <input type="file" id="post-image" class="form-input" accept="image/*">
      </div>
      <div class="form-group" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:600;font-size:.9375rem">تثبيت الإعلان</div>
          <div class="text-sm text-muted">سيظهر أعلى صفحة الأخبار</div>
        </div>
        <label class="toggle"><input type="checkbox" id="post-pinned"><span class="toggle-slider"></span></label>
      </div>
      <button id="btn-submit-post" class="btn btn-primary w-full" onclick="App.handlePost()"><span class="icon icon-sm icon-white">${Icons.send}</span> نشر</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  handlePost() {
    const type    = document.getElementById('post-type').value;
    const title   = document.getElementById('post-title').value.trim();
    const content = document.getElementById('post-content').value.trim();
    const isPinned = document.getElementById('post-pinned').checked;
    const imageFile = document.getElementById('post-image').files[0];
    const user    = Auth.currentUser();
    const btn     = document.getElementById('btn-submit-post');
    const effectiveGroupId = this._getEffectiveGroupId();

    if (!content && !imageFile) return this.toast('الرجاء كتابة المحتوى أو إرفاق صورة','error');
    
    btn.disabled = true;
    btn.innerHTML = 'جاري النشر...';

    const saveToDB = (imageBase64 = null) => {
      DB.addAnnouncement({ 
        groupId: effectiveGroupId, 
        authorId: user.id, 
        authorName: user.name, 
        type, 
        title, 
        content,
        isPinned,
        image: imageBase64 
      });
      this.closeModal();
      this.toast('تم نشر الإعلان');
      this.renderNews();
    };

    if (imageFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const max_size = 1000;
          let width = img.width, height = img.height;
          if (width > height) {
            if (width > max_size) { height *= max_size / width; width = max_size; }
          } else {
            if (height > max_size) { width *= max_size / height; height = max_size; }
          }
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
          saveToDB(compressedBase64);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(imageFile);
    } else {
      saveToDB(null);
    }
  },

  // ─────────────────────────────────────────────────────────
  // SEND REMINDER — WhatsApp + Telegram mechanism
  // ─────────────────────────────────────────────────────────
  showSendReminderModal() {
    const user   = Auth.currentUser();
    const effectiveGroupId = this._getEffectiveGroupId();
    const group  = DB.getGroup(effectiveGroupId);
    const month  = DB.getMonthLabel(DB.getCurrentMonthKey());
    const unpaid = DB.getDonorsByGroup(group.id).filter(d => {
      const cur = DB.getCurrentMonthKey();
      const s   = DB.getDonationStatus(group.id, cur, d.id);
      return !s || !s.paid;
    });

    const msg = encodeURIComponent(
      `السلام عليكم ورحمة الله\n\nتذكير بموعد تبرع كفالة الأيتام — ${month}\n${group.name}\n\nالمبلغ المطلوب لكل يتيم: ${this.fmt(group.costPerOrphan||25000)} دينار\n\nيُرجى التواصل مع جامع التبرعات في أسرع وقت.\n\nجزاكم الله خيراً\nإدارة تطبيق ومن أحياها`
    );

    const donorRows = unpaid.slice(0, 10).map(d => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600;font-size:.9rem">${this.esc(d.name)}</div>
          <div class="text-xs ${d.telegramChatId ? 'text-success' : 'text-muted'}">${d.telegramChatId ? '✓ مرتبط بالبوت' : (d.phone||'')}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${d.telegramChatId ? `
            <button class="btn btn-primary" style="padding:4px 10px;font-size:.75rem;height:28px" onclick="App.sendBotReminders(['${d.id}'])">
              <span class="icon icon-sm icon-white">${Icons.telegram}</span> إرسال بالبوت
            </button>` :
           (d.phone ? `
            <a href="https://wa.me/${App.intlPhone(d.phone)}?text=${msg}" target="_blank" onclick="App.logManualReminder('wa_reminder')" class="wa-btn wa-btn-whatsapp" style="padding:6px 10px;font-size:.75rem">
              <span class="icon icon-sm">${Icons.whatsapp}</span>
            </a>
            <a href="https://t.me/+${App.intlPhone(d.phone)}?text=${msg}" target="_blank" onclick="App.logManualReminder('tg_manual_reminder')" class="wa-btn wa-btn-telegram" style="padding:6px 10px;font-size:.75rem">
              <span class="icon icon-sm">${Icons.telegram}</span>
            </a>` : '<span class="text-xs text-muted">لا يوجد رقم</span>')}
        </div>
      </div>`).join('');

    this._openModal(`
      <div class="modal-header">
        <div class="modal-title">إرسال تذكير التبرع</div>
        <div class="modal-subtitle">${unpaid.length} متبرع لم يسدّدوا بعد هذا الشهر</div>
      </div>
      <div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--r-md);padding:14px 16px;margin-bottom:12px;font-size:.875rem;color:var(--warning)">
        <strong>مسودة رسالة التذكير:</strong>
        <div style="margin-top:8px;white-space:pre-line;color:var(--text-body);font-size:.8125rem">${this.esc(decodeURIComponent(msg))}</div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label" style="font-size:.8125rem">تعليق إضافي (يُرسل حصراً عبر البوت)</label>
        <textarea id="bot-custom-comment" class="form-input" placeholder="مثال: خذ وقتك يا بطل، فقط للتذكير..."></textarea>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <button class="btn btn-primary" style="flex:1" onclick="App.sendBotReminders(null)">
           <span class="icon icon-sm icon-white">${Icons.telegram}</span> إرسال للكل عبر البوت
        </button>
        <a href="https://wa.me/?text=${msg}" target="_blank" onclick="App.logManualReminder('wa_reminder')" class="btn btn-outline" style="flex:1;justify-content:center;color:#25D366;border-color:#25D366">
          <span class="icon icon-sm">${Icons.whatsapp}</span> رسالة واتساب
        </a>
      </div>
      <div style="font-weight:700;margin-bottom:8px;font-size:.9rem">إرسال فردي:</div>
      ${unpaid.length ? donorRows : '<p class="text-muted text-center">جميع المتبرعين سدّدوا</p>'}
      <button class="btn btn-ghost w-full" style="margin-top:16px" onclick="App.closeModal()">إغلاق</button>`);
  },

  async sendBotReminders(userIds) {
    const user  = Auth.currentUser();
    const effectiveGroupId = this._getEffectiveGroupId();
    const group = DB.getGroup(effectiveGroupId);
    const month = DB.getMonthLabel(DB.getCurrentMonthKey());
    const unpaid = DB.getDonorsByGroup(group.id).filter(d => {
      const s = DB.getDonationStatus(group.id, DB.getCurrentMonthKey(), d.id);
      return !s || !s.paid;
    });

    const targetUsers = userIds ? unpaid.filter(u => userIds.includes(u.id)) : unpaid;
    const usersWithTg = targetUsers.filter(u => u.telegramChatId);

    if (usersWithTg.length === 0) {
      return this.toast('لا يوجد متبرعون مرتبطون ببوت التليجرام في هذه القائمة.', 'warning');
    }

    const commentEl = document.getElementById('bot-custom-comment');
    const comment = commentEl ? commentEl.value.trim() : '';
    const baseMsg = `السلام عليكم ورحمة الله\n\nتذكير بموعد تبرع كفالة الأيتام — ${month}\n${group.name}\n\nالمبلغ المطلوب لكل يتيم: ${this.fmt(group.costPerOrphan||25000)} دينار`;
    const finalMsg = comment ? `${baseMsg}\n\nملاحظة من المسؤول:\n${comment}\n\nجزاكم الله خيراً` : `${baseMsg}\n\nيُرجى التواصل مع المستلم في أسرع وقت.\nجزاكم الله خيراً`;

    const messages = usersWithTg.map(u => ({
      chatId: u.telegramChatId,
      text: `مرحباً ${u.name},\n\n${finalMsg}`
    }));

    try {
      this.toast('جاري الإرسال للمعالجة...', 'success');
      const group = DB.getGroup(effectiveGroupId);
      const data = await API.post('/api/send-reminders', { messages });
      if (data.success) {
        if (user && (user.role === 'superadmin' || user.role === 'admin' || user.role === 'collector')) {
          const effectiveGroupId = this._getEffectiveGroupId();
          DB.logCollectorAction(effectiveGroupId, DB.getCurrentMonthKey(), user.id, 'bot_reminder');
        }
        this.toast(`تمت إضافة ${data.count} إشعار لطابور الإرسال للتليجرام.`);
        this.closeModal();
      } else {
        this.toast('حدث خطأ في الإرسال.', 'error');
      }
    } catch (e) {
      this.toast('تعذر الاتصال بخادم البوت.', 'error');
    }
  },

  logManualReminder(type) {
    const user = Auth.currentUser();
    if(user && (user.role === 'superadmin' || user.role === 'collector' || user.role === 'admin')) {
      const effectiveGroupId = this._getEffectiveGroupId();
      DB.logCollectorAction(effectiveGroupId, DB.getCurrentMonthKey(), user.id, type);
    }
  },

  async linkTelegram() {
    const btn = document.getElementById('btn-link-tg');
    const oldText = btn.innerHTML;
    btn.innerHTML = 'جاري التوليد...';
    btn.disabled = true;

    try {
      const data = await API.post('/api/auth-code', {});
      if (!data.success) throw new Error('Api failed');

      const code = data.code;
      const botUsername = data.botUsername;
      if (!botUsername) throw new Error('telegram bot not configured');
      const botUrl = `https://t.me/${botUsername}?start=${code}`;
      
      btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.telegram}</span> بانتظار التأكيد على تليجرام...`;

      // Insert the manual fallback link BEFORE opening (so user can always tap it)
      const existingManual = document.getElementById('manual-tg-link');
      if (!existingManual) {
        btn.insertAdjacentHTML('afterend', `<div id="manual-tg-link" style="text-align:center;margin-top:12px;font-size:0.9rem"><a href="${botUrl}" target="_blank" style="color:var(--warning-dark);text-decoration:underline;font-weight:700">لم يفتح التليجرام؟ اضغط هنا يدوياً</a></div>`);
      }

      // NOTE: window.open must be called synchronously from a user gesture.
      // We call it here after await, so it may be blocked. The manual link above is the reliable fallback.
      try { window.open(botUrl, '_blank'); } catch(_) {}

      // Poll until linked — store IDs so navigate() can cancel them
      this._tgPollInterval = setInterval(async () => {
        try {
          const pollData = await API.get(`/api/check-auth/${code}`);
          if (pollData.success && pollData.status === 'linked') {
            clearInterval(this._tgPollInterval);
            clearTimeout(this._tgPollTimeout);
            this._tgPollInterval = null;
            this._tgPollTimeout = null;
            const user = Auth.currentUser();
            user.telegramChatId = pollData.chatId;
            DB.saveUser({ ...user, _noSync: true });
            SyncQueue.enqueue({ method: 'POST', path: `/api/users/${user.id}/telegram-link`, body: { code } });
            this.toast('تم تأكيد الربط وسحب هويتك بنجاح!');
            this.renderProfile();
          }
        } catch (pollErr) {
          console.error(pollErr);
        }
      }, 3000);

      // Timeout after 3 minutes
      this._tgPollTimeout = setTimeout(() => {
        clearInterval(this._tgPollInterval);
        this._tgPollInterval = null;
        this._tgPollTimeout = null;
        const tgCard = document.getElementById('btn-link-tg');
        if (tgCard && tgCard.disabled) {
          tgCard.disabled = false;
          tgCard.innerHTML = oldText;
          this.toast('انتهت مهلة الربط. حاول مجدداً.', 'warning');
        }
      }, 180000);

    } catch (e) {
      this.toast('تعذر الاتصال بخادم البوت لطلب الرابط.', 'error');
      btn.innerHTML = oldText;
      btn.disabled = false;
    }
  },

  showEditAnnouncementModal(id) {
    const a = DB.getAnnouncements().find(x => x.id === id);
    if (!a) return;
    this._openModal(`
      <div class="modal-header"><div class="modal-title">تعديل الإعلان</div></div>
      <div class="form-group">
        <label class="form-label">العنوان</label>
        <input type="text" id="edit-ann-title" class="form-input" value="${this.esc(a.title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">المحتوى</label>
        <textarea id="edit-ann-content" class="form-input" style="min-height:120px">${this.esc(a.content||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="flex-between" style="cursor:pointer">
          <span class="form-label" style="margin:0">تثبيت الإعلان في الأعلى</span>
          <input type="checkbox" id="edit-ann-pin" ${a.isPinned?'checked':''}>
        </label>
      </div>
      <button class="btn btn-primary w-full" onclick="App.handleEditAnnouncement('${id}')">حفظ التغييرات</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>
    `);
  },

  handleEditAnnouncement(id) {
    const title = document.getElementById('edit-ann-title').value.trim();
    const content = document.getElementById('edit-ann-content').value.trim();
    const isPinned = document.getElementById('edit-ann-pin').checked;

    if (!content) return this.toast('الرجاء كتابة المحتوى', 'error');

    DB.updateAnnouncement(id, { title, content, isPinned });
    this.closeModal();
    this.toast('تم تحديث الإعلان');
    this.renderNews();
  },

  deleteAnnouncement(id) {
    if(!confirm('هل أنت متأكد من حذف هذا الإعلان؟')) return;
    DB.deleteAnnouncement(id);
    this.toast('تم حذف الإعلان');
    this.renderNews();
  },

  // ─────────────────────────────────────────────────────────
  // LEADERBOARD
  // ─────────────────────────────────────────────────────────
  renderLeaderboard() {
    const view   = this._show('view-leaderboard');
    const lb     = DB.getLeaderboard();
    const medals = ['1','2','3'];

    view.innerHTML = `
      <div class="container">
        <div class="section-header"><h3 class="section-title">لوحة المنافسة</h3></div>
        <p class="text-muted" style="margin-bottom:20px;font-size:.9rem">ترتيب المجموعات حسب نسبة إنجاز التبرعات لهذا الشهر</p>
        ${lb.map((g,i) => `
          <div class="leaderboard-item rank-${i+1} fade-up delay-${Math.min(i+1,4)}">
            <div class="lb-rank">${medals[i]||i+1}</div>
            <div class="avatar avatar-filled" style="font-size:.875rem">${g.name?this.esc(g.name[0]):'م'}</div>
            <div class="lb-info">
              <div class="lb-name">${this.esc(g.name)}</div>
              <div class="lb-detail">${this.fmt(g.totalDonors)} متبرع &nbsp;·&nbsp; ${g.orphansSponsored} يتيم</div>
            </div>
            <div class="lb-score">
              <span class="lb-score-value">${g.score}%</span>
              <span class="lb-score-label">إنجاز</span>
            </div>
          </div>`).join('')}

        <div class="card" style="margin-top:24px;background:var(--primary-bg);border-color:var(--primary)">
          <div style="font-weight:700;color:var(--primary);margin-bottom:12px">مجموع التبرعات الكلي (جميع الأشهر)</div>
          ${lb.map((g,i) => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <span style="font-weight:700;color:var(--text-muted);width:20px">${i+1}</span>
              <div style="flex:1">
                <div style="font-weight:600;font-size:.875rem">${this.esc(g.name)}</div>
                <div class="progress" style="margin-top:4px"><div class="progress-bar" style="width:${lb[0].allTimeTotal?Math.round(g.allTimeTotal/lb[0].allTimeTotal*100):0}%"></div></div>
              </div>
              <span style="font-weight:700;color:var(--primary);font-size:.875rem">${this.fmt(g.allTimeTotal)} د.ع</span>
            </div>`).join('')}
        </div>
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // COLLECTORS PAGE
  // ─────────────────────────────────────────────────────────
  renderCollectors() {
    const view = this._show('view-collectors');
    const user = Auth.currentUser();
    if (!user) return;

    const effectiveGroupId = this._getEffectiveGroupId();
    const collectors = DB.getCollectorsByGroup(effectiveGroupId);
    const group = DB.getGroup(effectiveGroupId);
    const curMonth = DB.getCurrentMonthKey();

    let groupPickerHtml = '';
    if (user.role === 'superadmin') {
      const allGroups = DB.getAllGroupsList();
      groupPickerHtml = `
        <div style="margin-bottom:16px">
          <label class="form-label text-sm text-muted" style="display:block;margin-bottom:4px">اختر الحملة (للمدير العام):</label>
          <select class="form-input form-select" onchange="App.superAdminViewGroup(this.value)">
            ${allGroups.map(g => `<option value="${g.id}" ${g.id===effectiveGroupId?'selected':''}>${this.esc(g.name)}</option>`).join('')}
          </select>
        </div>`;
    }

    view.innerHTML = `
      <div class="container pb-nav">
        <div class="section-header"><h3 class="section-title">مسؤولو جمع التبرعات</h3></div>
        <p class="text-muted" style="margin-bottom:20px;font-size:.9rem">تواصل مع المسؤول المناسب لتسليم تبرعك</p>
        ${groupPickerHtml}

        ${user.role !== 'donor' ? `
        <div style="margin-bottom:20px">
          <div class="flex-between" style="margin-bottom:10px">
            <h4 style="font-size:1rem;font-weight:800;color:var(--text-heading)">بلاغات الدفع الواردة</h4>
            <button class="btn btn-primary btn-sm" onclick="App.showPayReportModal()">
              <span class="icon icon-sm">${Icons.plus}</span> إضافة بلاغ استلام
            </button>
          </div>
          ${(() => {
            const reports = DB.getPayReports(effectiveGroupId).filter(r => !r.acknowledged);
            const myPending = reports.filter(r => {
              const donor = DB.getUser(r.donorId);
              return donor && donor.collectorId === user.id;
            });
            const otherPending = user.role === 'collector'
              ? reports.filter(r => r.reportedByCollectorId === user.id)
              : reports;

            if (reports.length === 0) return `<p class="text-muted text-sm" style="padding:12px;background:var(--gray-50);border-radius:var(--r-md)">لا توجد بلاغات معلقة</p>`;

            // Reports directed at this collector (my donors paid someone else)
            const incomingHtml = myPending.map(r => {
              const rDonor = DB.getUser(r.donorId);
              const rCol   = DB.getUser(r.reportedByCollectorId);
              return `
                <div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--r-md);padding:12px;margin-bottom:8px">
                  <div class="flex-between">
                    <div>
                      <div style="font-weight:700;color:var(--warning-dark)">⚠ دفع ${this.esc(rDonor?.name || r.donorName)} لـ ${this.esc(rCol?.name || 'مسؤول آخر')}</div>
                      <div class="text-xs text-muted">${this.fmt(r.amount)} د.ع — ${this.timeAgo(r.createdAt)}</div>
                    </div>
                    <button class="btn btn-sm" style="background:var(--success);color:white;border:none" onclick="App.acknowledgePayReport('${r.id}','${r.donorId}')">تأكيد ✓</button>
                  </div>
                  ${r.note ? `<div class="text-sm" style="margin-top:6px;color:var(--text-body)">${this.esc(r.note)}</div>` : ''}
                </div>`;
            }).join('');

            // Reports this collector filed (I received from someone else's donor)
            const outgoingHtml = otherPending.filter(r => r.reportedByCollectorId === user.id && !myPending.includes(r)).map(r => {
              const rDonor = DB.getUser(r.donorId);
              const rOwner = DB.getUser(DB.getUser(r.donorId)?.collectorId);
              return `
                <div style="background:var(--primary-bg);border:1px solid var(--primary);border-radius:var(--r-md);padding:12px;margin-bottom:8px;font-size:.875rem">
                  <span style="font-weight:700">📤 استلمت من:</span> ${this.esc(rDonor?.name || r.donorName)} — ${this.fmt(r.amount)} د.ع
                  <span class="text-muted"> (ينتظر تأكيد ${this.esc(rOwner?.name || 'المسؤول الآخر')})</span>
                </div>`;
            }).join('');

            // Admin/superadmin — show all
            const adminAllHtml = (user.role === 'admin' || user.role === 'superadmin') && !myPending.length && !outgoingHtml
              ? reports.map(r => {
                  const rDonor = DB.getUser(r.donorId);
                  const rCol   = DB.getUser(r.reportedByCollectorId);
                  return `
                    <div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--r-md);padding:12px;margin-bottom:8px">
                      <div class="flex-between">
                        <div>
                          <div style="font-weight:700;color:var(--warning-dark)">${this.esc(rDonor?.name || r.donorName)} دفع لـ ${this.esc(rCol?.name || '?')}</div>
                          <div class="text-xs text-muted">${this.fmt(r.amount)} د.ع — ${this.timeAgo(r.createdAt)}</div>
                        </div>
                        <button class="btn btn-sm" style="background:var(--success);color:white;border:none" onclick="App.acknowledgePayReport('${r.id}','${r.donorId}')">تأكيد ✓</button>
                      </div>
                    </div>`;
                }).join('')
              : '';

            return incomingHtml + outgoingHtml + adminAllHtml;
          })()}
        </div>` : ''}

        ${collectors.length===0 ? `
          <div class="empty-state">
            <div class="empty-icon">${Icons.users}</div>
            <div class="empty-title">لا يوجد مسؤولون</div>
          </div>` :
          collectors.map(c => {
            try {
              const myDonors = DB.getUsersByCollector(c.id);
              const paid = myDonors.filter(d=>DB.getDonationStatus(group.id,curMonth,d.id)?.paid).length;
              const lastBot = DB.getLastCollectorAction(group.id, curMonth, c.id, 'bot_reminder');
              const lastWa  = DB.getLastCollectorAction(group.id, curMonth, c.id, 'wa_reminder');
              const lastMan = DB.getLastCollectorAction(group.id, curMonth, c.id, 'tg_manual_reminder');
              let auditHtml = '';
              if (user.role === 'admin' || user.role === 'superadmin') {
                const parseDate = (d) => {
                  if (!d) return 'لم يرسل';
                  try {
                    return new Date(d).toLocaleDateString('ar-EG-u-nu-latn', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
                  } catch(e) { return 'مُرسل'; } // Fallback if WebKit locale throws RangeError
                };
                auditHtml = `
                <div style="background:var(--gray-50);border-radius:var(--r-sm);padding:10px;margin-top:12px;font-size:.75rem">
                  <div style="font-weight:700;color:var(--text-muted);margin-bottom:6px">سجل التذكيرات هذا الشهر:</div>
                  <div class="flex-between" style="margin-bottom:4px"><span>بوت تليجرام:</span><span style="font-weight:700;color:${lastBot?'var(--primary)':'var(--text-muted)'}">${parseDate(lastBot)}</span></div>
                  <div class="flex-between"><span>رسالة يدوية:</span><span style="font-weight:700;color:${lastWa||lastMan?'var(--success)':'var(--text-muted)'}">${parseDate(lastWa || lastMan)}</span></div>
                  <button class="btn btn-primary btn-sm w-full" style="margin-top:10px" onclick="App.viewCollectorGrid('${c.id}')">مراقبة جدول المتبرعين</button>
                </div>
              `;
            }
            
            let mapHtml = '';
            if (c.liveLocation?.active) {
              const ago = Math.floor((new Date() - new Date(c.liveLocation.updatedAt)) / 60000);
              mapHtml = `
                <div style="margin-bottom:12px">
                  <a href="https://maps.google.com/?q=${c.liveLocation.lat},${c.liveLocation.lng}" target="_blank" class="btn w-full" style="background:#25D366;color:white;border:none">
                    <span class="icon icon-sm icon-white">${Icons.mappin}</span> عرض موقعه المباشر الآن
                  </a>
                  <div class="text-xs text-muted text-center" style="margin-top:4px">مُحدث منذ ${ago} دقيقة</div>
                </div>
              `;
            }

              const month = DB.getMonthLabel(curMonth);
              const msgTxt = encodeURIComponent(`السلام عليكم\nتذكير بموعد تبرع كفالة الأيتام — ${month}`);

              return `
              <div class="avail-card">
                <div class="avail-header" style="${c.liveLocation?.active ? 'border-bottom:2px solid #25D366;padding-bottom:10px;margin-bottom:10px' : ''}">
                  <div class="avatar avatar-lg avatar-filled" style="font-size:1rem">${c.name?this.esc(c.name[0]):'م'}</div>
                  <div style="flex:1">
                    <div style="font-weight:700;font-size:1rem;color:var(--text-heading)">${this.esc(c.name)}</div>
                    <div class="text-sm text-muted">${this.esc(c.stage||'')}</div>
                  </div>
                  <span class="badge ${paid === myDonors.length && myDonors.length > 0 ? 'badge-success' : 'badge-warning'}" style="${user.role === 'donor' ? 'display:none' : ''}">${this.fmt(paid)}/${this.fmt(myDonors.length)} متبرع</span>
                </div>
                ${mapHtml}
                ${c.availability ? `
                <div class="avail-tags">
                  <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.calendar}</span> ${this.esc(c.availability.days)}</span>
                  <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.clock}</span> ${c.availability.startTime} – ${c.availability.endTime}</span>
                  <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.mappin}</span> ${this.esc(c.availability.location)}</span>
                </div>` : ''}
                <div class="avail-actions">
                  ${c.phone ? `
                    <a href="tel:${c.phone}" class="btn btn-outline btn-sm"><span class="icon icon-sm">${Icons.phone}</span> اتصال</a>
                    <a href="https://wa.me/${App.intlPhone(c.phone)}?text=${msgTxt}" target="_blank" class="wa-btn wa-btn-whatsapp" style="font-size:.8125rem">
                      <span class="icon icon-sm">${Icons.whatsapp}</span> واتساب
                    </a>
                    <a href="https://t.me/+${App.intlPhone(c.phone)}?text=${msgTxt}" target="_blank" class="wa-btn wa-btn-telegram" style="font-size:.8125rem">
                      <span class="icon icon-sm">${Icons.telegram}</span> تيليجرام
                    </a>` : '<span class="text-muted text-sm">لا يوجد رقم</span>'}
                </div>
                ${auditHtml}
              </div>`;
            } catch(err) {
               return `<div style="padding:20px;background:var(--error-bg);color:var(--error);border:1px solid var(--error);margin-bottom:10px;border-radius:8px">حدث خطأ أثناء عرض بيانات المسؤول: ${err.message}. يرجى المحاولة لاحقاً.</div>`;
            }
          }).join('')}
      </div>`;
  },

  viewCollectorGrid(collectorId) {
    this._gridFilterCollectorId = collectorId;
    this.navigate('grid');
  },

  // ─────────────────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────────────────
  renderProfile() {
    const view  = this._show('view-profile');
    const user  = Auth.currentUser();
    if (!user) return this.navigate('landing');
    
    const effectiveGroupId = this._getEffectiveGroupId();
    const group = DB.getGroup(effectiveGroupId);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const roleLabel = {superadmin:'المدير العام', admin:'مسؤول المجموعة', collector:'جامع التبرعات', donor:'متبرع'}[user.role]||'';

    view.innerHTML = `
      <div class="container">
        <div class="card fade-up" style="text-align:center;margin-bottom:16px">
          <div class="avatar avatar-xl avatar-filled" style="margin:0 auto var(--sp-4);font-size:1.75rem">${user.name?this.esc(user.name[0]):'م'}</div>
          <h3>${this.esc(user.name)}</h3>
          <div style="margin-top:8px"><span class="badge badge-primary">${roleLabel}</span></div>
          <div style="margin-top:8px;color:var(--text-muted);font-size:.9rem">${this.esc(group?.name||'')}</div>
          ${user.phone ? `<div style="margin-top:4px;color:var(--text-muted);font-size:.85rem;direction:ltr">${user.phone}</div>` : ''}
        </div>

        ${user.role==='collector' ? `
        <div class="card fade-up delay-1" style="margin-bottom:16px">
          <div class="section-header" style="margin-bottom:14px">
            <h4 class="section-title">أوقات التواجد</h4>
            <button class="btn btn-outline btn-sm" onclick="App.showAvailabilityModal()">تعديل</button>
          </div>
          ${user.availability ? `
            <div class="avail-tags" style="margin-bottom:16px">
              <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.calendar}</span> ${this.esc(user.availability.days)}</span>
              <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.clock}</span> ${user.availability.startTime} – ${user.availability.endTime}</span>
              <span class="avail-tag"><span class="icon icon-sm icon-primary">${Icons.mappin}</span> ${this.esc(user.availability.location)}</span>
            </div>` : `<p class="text-muted text-sm" style="margin-bottom:16px">لم تُضف أوقات تواجد بعد</p>`}
            
          <button class="btn ${user.liveLocation?.active ? 'btn-outline' : 'btn-primary'} w-full" style="margin-bottom:12px; ${user.liveLocation?.active ? 'color:var(--error);border-color:var(--error)' : 'background:#25D366;border-color:#25D366'}" onclick="App.toggleGPS(${!user.liveLocation?.active})">
            <span class="icon icon-sm ${user.liveLocation?.active ? '' : 'icon-white'}">${Icons.mappin}</span> 
            ${user.liveLocation?.active ? 'إيقاف إعلان التواجد' : 'إعلان التواجد الآن (مباشر)'}
          </button>
          ${!user.liveLocation?.active ? '<div class="text-xs text-muted" style="margin-bottom:12px;text-align:center">سينشر البوت رابط موقعك الجغرافي (GPS) للمتبرعين للتوجه إليك.</div>' : ''}

          <button class="btn btn-outline btn-sm w-full" onclick="App.showSendReminderModal()">
            <span class="icon icon-sm">${Icons.send}</span> إرسال تذكير للمتبرعين
          </button>
        </div>` : ''}

        ${user.role === 'donor' && group?.botUsername ? (!user.telegramChatId ? `
        <div class="card fade-up delay-1" id="tg-link-card" style="margin-bottom:16px;background:var(--warning-bg);border:1px solid var(--warning)">
          <h4 style="color:var(--warning);margin-bottom:8px">الربط بالتليجرام</h4>
          <p class="text-sm" style="color:var(--warning-dark);margin-bottom:12px">لن نتمكن من إرسال إشعارات التذكير إليك بصورة آلية ما لم تقم بربط حسابك ببوت التليجرام الخاص بالحملة.</p>
          <button class="btn btn-primary w-full" id="btn-link-tg" onclick="App.linkTelegram()">
            <span class="icon icon-sm icon-white">${Icons.telegram}</span> ربط حسابي الآن
          </button>
        </div>` : `
        <div class="card fade-up delay-1" style="margin-bottom:16px;background:var(--success-bg);border:1px solid var(--success)">
          <div style="display:flex;align-items:center;gap:12px;color:var(--success-dark)">
            <div class="check-icon paid" style="width:28px;height:28px;flex-shrink:0">${Icons.check}</div>
            <div style="font-weight:600;font-size:.9rem">حسابك مرتبط بتليجرام بنجاح. ستصلك الإشعارات الدورية.</div>
          </div>
        </div>`) : ''}

        <div class="card fade-up delay-2" style="margin-bottom:16px">
          <h4 style="margin-bottom:16px">الإعدادات</h4>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-weight:600">الوضع الداكن</div>
              <div class="text-sm text-muted">تغيير مظهر التطبيق</div>
            </div>
            <label class="toggle"><input type="checkbox" ${isDark?'checked':''} onchange="App.toggleTheme()"><span class="toggle-slider"></span></label>
          </div>
        </div>

        ${user.role==='admin' ? `
        <div class="card fade-up delay-3" style="margin-bottom:16px">
          <h4 style="margin-bottom:14px">إدارة المجموعة</h4>
          <button class="btn btn-outline w-full" style="margin-bottom:8px" onclick="App.showAddCollectorModal()">
            <span class="icon icon-sm">${Icons.plus}</span> إضافة جامع تبرعات
          </button>
          <button class="btn btn-outline w-full" style="margin-bottom:8px" onclick="App.showTelegramBotModal('${user.groupId}')">
            <span class="icon icon-sm">${Icons.telegram}</span> بوت التليجرام للحملة
          </button>
          <button class="btn btn-ghost w-full" onclick="App.exportData()">
            <span class="icon icon-sm">${Icons.download}</span> تصدير البيانات (JSON)
          </button>
        </div>` : ''}

        ${user.role==='superadmin' ? `
        <div class="card fade-up delay-3" style="margin-bottom:16px;border-top:3px solid var(--gold)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--gold-bg);display:flex;align-items:center;justify-content:center;color:var(--gold)">${Icons.database}</div>
            <h4 style="margin:0">النسخ الاحتياطي والبيانات</h4>
          </div>

          <button class="btn btn-primary w-full" style="margin-bottom:10px;background:var(--gold);border-color:var(--gold)" onclick="App.exportFullBackup()">
            <span class="icon icon-sm icon-white">${Icons.download}</span> تصدير نسخة احتياطية كاملة (JSON)
          </button>

          <button class="btn btn-outline w-full" style="margin-bottom:10px" onclick="App.showExportCampaignModal()">
            <span class="icon icon-sm">${Icons.archive}</span> تصدير بيانات حملة محددة
          </button>

          <button class="btn btn-outline w-full" style="margin-bottom:10px" onclick="App.showImportRestoreModal()">
            <span class="icon icon-sm">${Icons.upload}</span> استيراد / استعادة البيانات
          </button>

          <button class="btn btn-ghost w-full" onclick="App.showBackupHistoryModal()">
            <span class="icon icon-sm">${Icons.clock}</span> سجل النسخ الاحتياطية
          </button>
        </div>
        <div class="card fade-up delay-3" style="margin-bottom:16px">
          <h4 style="margin-bottom:6px">تليجرام</h4>
          <p class="text-sm text-muted" style="margin-bottom:12px">بوت عام تستخدمه الحملات التي لم تضف بوتاً خاصاً بها. لكل حملة بوتها من زر الإعدادات على بطاقتها.</p>
          <button class="btn btn-outline w-full" onclick="App.showTelegramBotModal(null)">
            <span class="icon icon-sm">${Icons.telegram}</span> بوت التليجرام الافتراضي
          </button>
        </div>` : ''}

        <button class="btn btn-danger w-full fade-up delay-4" onclick="App.handleLogout()">
          <span class="icon icon-sm icon-white">${Icons.logout}</span> تسجيل الخروج
        </button>
        ${user.role !== 'superadmin' ? `
        <button class="btn btn-ghost w-full fade-up delay-4" style="margin-top:8px;color:var(--danger)" onclick="App.showDeleteAccountModal()">
          حذف حسابي
        </button>` : ''}
        <p class="text-center text-xs fade-up delay-4" style="margin:12px 0 4px">
          <a href="/privacy.html" target="_blank" rel="noopener">سياسة الخصوصية</a>
        </p>
      </div>`;
  },

  showAvailabilityModal() {
    const user = Auth.currentUser();
    const av   = user.availability || {};
    this._openModal(`
      <div class="modal-header"><div class="modal-title">تحديث أوقات التواجد</div></div>
      <div class="form-group">
        <label class="form-label">أيام التواجد</label>
        <input type="text" id="av-days" class="form-input" placeholder="الأحد — الخميس" value="${this.esc(av.days||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">من الساعة</label>
        <input type="time" id="av-start" class="form-input" value="${av.startTime||'09:00'}" dir="ltr">
      </div>
      <div class="form-group">
        <label class="form-label">إلى الساعة</label>
        <input type="time" id="av-end" class="form-input" value="${av.endTime||'12:00'}" dir="ltr">
      </div>
      <div class="form-group">
        <label class="form-label">المكان</label>
        <input type="text" id="av-loc" class="form-input" placeholder="كلية الهندسة — الطابق الثاني" value="${this.esc(av.location||'')}">
      </div>
      <button class="btn btn-primary w-full" onclick="App.handleAvailability()">حفظ</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  handleAvailability() {
    const user = Auth.currentUser();
    user.availability = {
      days:      document.getElementById('av-days').value.trim(),
      startTime: document.getElementById('av-start').value,
      endTime:   document.getElementById('av-end').value,
      location:  document.getElementById('av-loc').value.trim(),
    };
    DB.saveUser(user);
    this.closeModal();
    this.toast('تم تحديث أوقات التواجد');
    this.renderProfile();
  },

  // ─────────────────────────────────────────────────────────
  // ORPHANS
  // ─────────────────────────────────────────────────────────
  renderOrphans() {
    const view = this._show('view-orphans');
    const user = Auth.currentUser();
    if (!user) return;
    
    // Allow super admin to view orphans for a specific selected group, or overall if not set.
    // For simplicity, we just use the effective group ID. If superadmin didn't select one,
    // they see all orphans from all groups, but the UI might be better restricted per-group.
    const effectiveGroupId = this._getEffectiveGroupId();
    const groupName = effectiveGroupId ? DB.getGroup(effectiveGroupId)?.name : 'كل الأيتام';
    const orphans = DB.getOrphansByGroup(effectiveGroupId);
    
    const canManage = user.role === 'admin' || user.role === 'superadmin';

    // Calculate days until birthday
    const getDaysTillBirthday = (bdate) => {
      if (!bdate) return 'غير محدد';
      const today = new Date();
      const birth = new Date(bdate);
      let nextBirth = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
      if (today > nextBirth) {
        nextBirth.setFullYear(today.getFullYear() + 1);
      }
      const diffTime = Math.abs(nextBirth - today);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    };

    view.innerHTML = `
      <div class="container pb-nav">
        <div class="section-header" style="justify-content:center;margin-bottom:20px;position:relative">
          <h3 class="section-title" style="margin:0">الايتام</h3>
        </div>
        
        ${canManage ? `
          <button class="btn btn-primary w-full" style="margin-bottom:16px" onclick="App.showAddOrphanModal()">
            <span class="icon icon-sm">${Icons.plus}</span> إضافة يتيم للمجموعة (${this.esc(groupName || '')})
          </button>
        ` : ''}

        ${orphans.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">${Icons.baby}</div>
            <div class="empty-title">لا يوجد أيتام</div>
          </div>
        ` : orphans.map((o, i) => `
          <div class="card fade-up delay-${Math.min(i, 5)}" style="margin-bottom:16px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;display:flex;padding:0;overflow:hidden">
            <!-- Right side (Avatar + Name) -->
            <div style="flex:0 0 120px;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-left:1px solid var(--border)">
              <div style="width:70px;height:70px;background:var(--primary);border-radius:16px;display:flex;align-items:center;justify-content:center;color:white;margin-bottom:12px">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <div style="font-weight:700;color:var(--primary);font-size:.85rem;text-align:center;line-height:1.4">${this.esc(o.name)}</div>
              <div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">${o.birthDate ? o.birthDate.replace(/-/g,'/') : ''}</div>
            </div>
            <!-- Left side (Details Grid) -->
            <div style="flex:1;padding:16px 12px;display:flex;flex-direction:column;justify-content:center;gap:8px">
              <div style="display:flex;justify-content:flex-start;font-size:.85rem;border-bottom:1px solid var(--border);padding-bottom:4px">
                <span style="font-weight:700;color:var(--text-heading)">الرمز : ${this.esc(o.code)}</span>
              </div>
              <div style="display:flex;justify-content:flex-start;font-size:.85rem;border-bottom:1px solid var(--border);padding-bottom:4px">
                <span style="font-weight:700;color:var(--text-muted)">المحافظة : ${this.esc(o.province)}</span>
              </div>
              <div style="display:flex;justify-content:flex-start;font-size:.85rem;border-bottom:1px solid var(--border);padding-bottom:4px">
                <span style="font-weight:700;color:var(--text-muted)">نوع الكفالة : ${this.esc(o.type)}</span>
              </div>
              <div style="display:flex;justify-content:flex-start;font-size:.85rem;border-bottom:1px solid var(--border);padding-bottom:4px">
                <span style="font-weight:700;color:var(--text-heading)">مبلغ الكفالة : <span style="color:var(--primary)">${this.fmt(o.amount)}</span></span>
              </div>
              <div style="display:flex;justify-content:flex-start;font-size:.85rem;color:var(--text-heading);font-weight:700;align-items:center;gap:4px">
                <span>تبقى على عيد الميلاد : ${getDaysTillBirthday(o.birthDate)} يوم</span>
                <span style="color:var(--gold)">${Icons.clock}</span>
              </div>
            </div>
            ${canManage ? `
            <div style="position:absolute;top:8px;left:8px;display:flex;gap:4px">
              <button class="icon-btn primary" title="تعديل" aria-label="تعديل بيانات ${this.esc(o.name)}" onclick="event.stopPropagation(); App.showEditOrphanModal('${o.id}')">
                ${Icons.edit}
              </button>
              <button class="icon-btn danger" title="حذف" aria-label="حذف ${this.esc(o.name)}" onclick="event.stopPropagation(); App.deleteOrphan('${o.id}')">
                ${Icons.trash}
              </button>
            </div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  },

  showAddOrphanModal() {
    this._openModal(`
      <div class="modal-header"><div class="modal-title">إضافة يتيم جديد</div></div>
      <div class="form-group">
        <label class="form-label">اسم اليتيم</label>
        <input type="text" id="orph-name" class="form-input" placeholder="الاسم الكامل">
      </div>
      <div class="form-group">
        <label class="form-label">الرمز (Code)</label>
        <input type="text" id="orph-code" class="form-input" placeholder="AAA00000-0" dir="ltr" style="text-align:right">
      </div>
      <div class="form-group">
        <label class="form-label">المحافظة</label>
        <input type="text" id="orph-prov" class="form-input" placeholder="بغداد، البصرة...">
      </div>
      <div class="form-group">
        <label class="form-label">نوع الكفالة</label>
        <input type="text" id="orph-type" class="form-input" value="اعتيادية">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ الكفالة (د.ع)</label>
        <input type="number" inputmode="numeric" id="orph-amount" class="form-input" value="95000" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">تاريخ الميلاد</label>
        <input type="date" id="orph-date" class="form-input">
      </div>
      <button class="btn btn-primary w-full" onclick="App.handleAddOrphan()">حفظ الإضافة</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>
    `);
  },

  handleAddOrphan() {
    const name = document.getElementById('orph-name').value.trim();
    const code = document.getElementById('orph-code').value.trim();
    const province = document.getElementById('orph-prov').value.trim();
    const type = document.getElementById('orph-type').value.trim();
    const amount = parseInt(document.getElementById('orph-amount').value) || 0;
    const birthDate = document.getElementById('orph-date').value;

    if (!name || !code || !birthDate) return this.toast('الرجاء تعبئة الاسم والرمز وتاريخ الميلاد', 'error');

    DB.saveOrphan({
      groupId: this._getEffectiveGroupId(),
      name, code, province, type, amount, birthDate
    });

    this.closeModal();
    this.toast('تمت إضافة اليتيم بنجاح');
    this.renderOrphans();
  },

  showEditOrphanModal(id) {
    const o = DB.getOrphans().find(x => x.id === id);
    if (!o) return;
    this._openModal(`
      <div class="modal-header"><div class="modal-title">تعديل بيانات اليتيم</div></div>
      <div class="form-group">
        <label class="form-label">اسم اليتيم</label>
        <input type="text" id="edit-orph-name" class="form-input" value="${this.esc(o.name||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">الرمز (Code)</label>
        <input type="text" id="edit-orph-code" class="form-input" value="${this.esc(o.code||'')}" dir="ltr" style="text-align:right">
      </div>
      <div class="form-group">
        <label class="form-label">المحافظة</label>
        <input type="text" id="edit-orph-prov" class="form-input" value="${this.esc(o.province||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">نوع الكفالة</label>
        <input type="text" id="edit-orph-type" class="form-input" value="${this.esc(o.type||'اعتيادية')}">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ الكفالة (د.ع)</label>
        <input type="number" inputmode="numeric" id="edit-orph-amount" class="form-input" value="${o.amount||95000}" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">تاريخ الميلاد</label>
        <input type="date" id="edit-orph-date" class="form-input" value="${o.birthDate||''}">
      </div>
      <button class="btn btn-primary w-full" onclick="App.handleEditOrphan('${id}')">حفظ التعديلات</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>
    `);
  },

  handleEditOrphan(id) {
    const name = document.getElementById('edit-orph-name').value.trim();
    const code = document.getElementById('edit-orph-code').value.trim();
    const province = document.getElementById('edit-orph-prov').value.trim();
    const type = document.getElementById('edit-orph-type').value.trim();
    const amount = parseInt(document.getElementById('edit-orph-amount').value) || 0;
    const birthDate = document.getElementById('edit-orph-date').value;

    if (!name || !code || !birthDate) return this.toast('الرجاء تعبئة الاسم والرمز وتاريخ الميلاد', 'error');

    DB.saveOrphan({
      id,
      groupId: this._getEffectiveGroupId(),
      name, code, province, type, amount, birthDate
    });

    this.closeModal();
    this.toast('تم تحديث بيانات اليتيم');
    this.renderOrphans();
  },

  deleteOrphan(id) {
    if(!confirm('هل أنت متأكد من حذف بيانات اليتيم؟')) return;
    DB.deleteOrphan(id);
    this.toast('تم الحذف');
    this.renderOrphans();
  },


  showAddCollectorModal() {
    this._openModal(`
      <div class="modal-header"><div class="modal-title">إضافة جامع تبرعات</div></div>
      <div class="form-group">
        <label class="form-label">الاسم</label>
        <input type="text" id="coll-name" class="form-input" placeholder="اسم الجامع">
      </div>
      <div class="form-group">
        <label class="form-label">رقم الهاتف</label>
        <input type="tel" id="coll-phone" class="form-input" placeholder="07xxxxxxxxx" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">الرمز السري (PIN)</label>
        <input type="text" id="coll-pin" class="form-input" placeholder="4 أرقام أو أكثر" maxlength="20" inputmode="numeric" dir="ltr" style="text-align:center">
      </div>
      <div class="form-group">
        <label class="form-label">المرحلة الدراسية</label>
        <input type="text" id="coll-stage" class="form-input" placeholder="المرحلة الرابعة">
      </div>
      <button class="btn btn-primary w-full" onclick="App.handleAddCollector()">إضافة</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  async handleAddCollector() {
    const name  = document.getElementById('coll-name').value.trim();
    const phone = document.getElementById('coll-phone').value.trim();
    const pin   = document.getElementById('coll-pin').value.trim();
    const stage = document.getElementById('coll-stage').value.trim();
    if (!name||!phone) return this.toast('الرجاء ملء الحقول','error');
    if (pin.length < 4) return this.toast('رمز الدخول يجب أن يكون 4 أرقام على الأقل', 'error');
    try {
      await Auth.registerCollector({ name, phone, pin, groupId: this._getEffectiveGroupId(), stage });
      this.closeModal();
      this.toast('تمت إضافة جامع التبرعات');
    } catch (err) {
      this.toast(err.message || 'فشل إضافة جامع التبرعات', 'error');
    }
  },

  exportData() {
    const data = DB.exportAll();
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'),{href:url,download:`waman-${new Date().toISOString().slice(0,10)}.json`});
    a.click(); URL.revokeObjectURL(url);
    this.toast('تم التصدير');
  },

  // ─────────────────────────────────────────────────────────────
  // SUPERADMIN: BACKUP & DATA MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  _downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },

  async exportFullBackup() {
    const btn = event?.target?.closest?.('button');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.refresh}</span> جارٍ التصدير...`; }
    try {
      const data = await API.get('/api/export');
      const filename = `waman-ahyaha-backup-${new Date().toISOString().slice(0,10)}.json`;
      this._downloadJSON(data, filename);
      const counts = data.users?.length || 0;
      this.toast(`تم تصدير النسخة الاحتياطية (${counts} مستخدم، ${data.donations?.length || 0} تبرع)`);
    } catch (err) {
      this.toast(err.message || 'فشل التصدير', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.download}</span> تصدير نسخة احتياطية كاملة (JSON)`; }
    }
  },

  showExportCampaignModal() {
    const groups = DB.getAllGroupsList();
    if (!groups.length) return this.toast('لا توجد حملات', 'error');
    const options = groups.map(g => `<option value="${g.id}">${this.esc(g.name)} — ${this.esc(g.university || '')}</option>`).join('');
    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--primary)">${Icons.archive}</span> تصدير بيانات حملة
        </div>
      </div>
      <p class="text-sm text-muted" style="margin-bottom:16px">اختر الحملة لتصدير جميع بياناتها (المتبرعين، التبرعات، الأيتام، الإعلانات)</p>
      <div class="form-group">
        <label class="form-label">الحملة</label>
        <select id="export-group-select" class="form-input form-select">${options}</select>
      </div>
      <button class="btn btn-primary w-full" id="btn-export-group" onclick="App.handleExportCampaign()">
        <span class="icon icon-sm icon-white">${Icons.download}</span> تصدير
      </button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  async handleExportCampaign() {
    const groupId = document.getElementById('export-group-select').value;
    const btn = document.getElementById('btn-export-group');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التصدير...'; }
    try {
      const data = await API.get('/api/export/group/' + groupId);
      const groupName = data.group?.name || 'حملة';
      const filename = `waman-${groupName}-${new Date().toISOString().slice(0,10)}.json`;
      this._downloadJSON(data, filename);
      this.closeModal();
      this.toast(`تم تصدير بيانات "${groupName}"`);
    } catch (err) {
      this.toast(err.message || 'فشل التصدير', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.download}</span> تصدير`; }
    }
  },

  showImportRestoreModal() {
    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--primary)">${Icons.upload}</span> استيراد / استعادة البيانات
        </div>
      </div>
      <div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:var(--r-md);padding:12px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:8px;color:var(--warning-dark)">
          <span class="icon icon-sm" style="flex-shrink:0;margin-top:2px">${Icons.bell}</span>
          <div class="text-sm">
            <strong>تنبيه:</strong> هذه العملية ستضيف البيانات من الملف إلى قاعدة البيانات الحالية. البيانات الموجودة مسبقاً لن تتأثر (لن يتم تكرارها).
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">اختر ملف النسخة الاحتياطية (.json)</label>
        <input type="file" id="import-file" class="form-input" accept=".json" style="padding:10px" onchange="App._previewImportFile()">
      </div>
      <div id="import-preview" style="display:none;background:var(--gray-50);border-radius:var(--r-md);padding:12px;margin-bottom:16px"></div>
      <button class="btn btn-primary w-full" id="btn-do-import" disabled onclick="App.handleImportRestore()">
        <span class="icon icon-sm icon-white">${Icons.upload}</span> استعادة البيانات
      </button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>`);
  },

  _previewImportFile() {
    const file = document.getElementById('import-file').files[0];
    const preview = document.getElementById('import-preview');
    const btn = document.getElementById('btn-do-import');
    if (!file) { preview.style.display = 'none'; btn.disabled = true; return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this._importData = data;
        const lines = [];
        if (data.exportDate) lines.push(`<div class="text-sm"><strong>تاريخ التصدير:</strong> ${new Date(data.exportDate).toLocaleString('ar-IQ')}</div>`);
        if (data.version) lines.push(`<div class="text-sm"><strong>الإصدار:</strong> ${this.esc(data.version)}</div>`);
        if (data.scope === 'group' && data.group) lines.push(`<div class="text-sm"><strong>النطاق:</strong> حملة "${this.esc(data.group.name)}"</div>`);
        const counts = [];
        if (data.groups) counts.push(`${Array.isArray(data.groups) ? data.groups.length : Object.keys(data.groups).length} حملة`);
        if (data.users) counts.push(`${Array.isArray(data.users) ? data.users.length : Object.keys(data.users).length} مستخدم`);
        if (data.donations) counts.push(`${Array.isArray(data.donations) ? data.donations.length : Object.keys(data.donations).length} تبرع`);
        if (data.orphans) counts.push(`${data.orphans.length} يتيم`);
        if (data.announcements) counts.push(`${data.announcements.length} إعلان`);
        if (counts.length) lines.push(`<div class="text-sm" style="margin-top:4px"><strong>المحتوى:</strong> ${counts.join(' · ')}</div>`);
        const sizeKB = (file.size / 1024).toFixed(1);
        lines.push(`<div class="text-sm" style="margin-top:4px"><strong>حجم الملف:</strong> ${sizeKB} كيلوبايت</div>`);
        if (data.checksum) lines.push(`<div class="text-xs text-muted" style="margin-top:4px;direction:ltr;font-family:monospace">SHA-256: ${data.checksum.slice(0,16)}...</div>`);

        preview.innerHTML = lines.join('');
        preview.style.display = 'block';
        btn.disabled = false;
      } catch {
        preview.innerHTML = `<div class="text-sm" style="color:var(--danger)">ملف غير صالح — يجب أن يكون ملف JSON من نسخة احتياطية سابقة</div>`;
        preview.style.display = 'block';
        btn.disabled = true;
        this._importData = null;
      }
    };
    reader.readAsText(file);
  },

  async handleImportRestore() {
    if (!this._importData) return this.toast('الرجاء اختيار ملف', 'error');
    const btn = document.getElementById('btn-do-import');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الاستعادة...'; }
    try {
      const result = await API.post('/api/import', this._importData);
      this._importData = null;
      this.closeModal();
      const s = result.imported || {};
      this.toast(`تمت الاستعادة: ${s.users||0} مستخدم، ${s.groups||0} حملة، ${s.donations||0} تبرع، ${s.orphans||0} يتيم`);
      await Auth.bootstrap().catch(() => {});
      this.renderHome();
    } catch (err) {
      this.toast(err.message || 'فشلت عملية الاستعادة', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.upload}</span> استعادة البيانات`; }
    }
  },

  async showBackupHistoryModal() {
    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--primary)">${Icons.clock}</span> سجل النسخ الاحتياطية
        </div>
      </div>
      <div id="backup-history-list" style="text-align:center;padding:24px">
        <div class="spinner"></div>
        <div class="text-sm text-muted" style="margin-top:8px">جارٍ التحميل...</div>
      </div>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إغلاق</button>`);

    try {
      const backups = await API.get('/api/export/backups');
      const container = document.getElementById('backup-history-list');
      if (!backups.length) {
        container.innerHTML = `<div class="text-muted text-sm" style="padding:16px;text-align:center">لا توجد نسخ احتياطية سابقة</div>`;
        return;
      }
      container.innerHTML = backups.map(b => {
        const date = new Date(b.created_at).toLocaleString('ar-IQ');
        const sizeMB = b.size_bytes ? (b.size_bytes / (1024*1024)).toFixed(2) : '—';
        const counts = b.record_counts || {};
        const summary = [
          counts.users && `${counts.users} مستخدم`,
          counts.groups && `${counts.groups} حملة`,
          counts.donations && `${counts.donations} تبرع`,
        ].filter(Boolean).join(' · ');
        return `
          <div style="padding:12px 0;border-bottom:1px solid var(--border)">
            <div class="flex-between" style="margin-bottom:4px">
              <div style="font-weight:600;font-size:.9rem">${date}</div>
              <span class="badge ${b.type==='scheduled'?'badge-primary':'badge-default'}">${b.type==='scheduled'?'تلقائي':'يدوي'}</span>
            </div>
            <div class="text-sm text-muted">${summary || 'بدون تفاصيل'}</div>
            <div class="text-xs text-muted" style="margin-top:2px">${sizeMB} ميغابايت ${b.actor_name ? '· ' + this.esc(b.actor_name) : ''}</div>
          </div>`;
      }).join('');
    } catch (err) {
      const container = document.getElementById('backup-history-list');
      if (container) container.innerHTML = `<div class="text-sm" style="color:var(--danger);padding:16px">فشل تحميل السجل</div>`;
    }
  },

  // A user deletes their own account (store requirement). Staff confirm with their PIN.
  showDeleteAccountModal() {
    const user = Auth.currentUser();
    if (!user) return;
    const needsPin = user.role !== 'donor';
    this._openModal(`
      <div class="modal-header"><div class="modal-title" style="color:var(--danger)">حذف حسابي</div></div>
      <p class="text-sm" style="line-height:1.9;margin-bottom:14px">
        سيتم مسح اسمك ورقم هاتفك وربط تليجرام وإنهاء جميع جلساتك. تبقى سجلات التبرعات السابقة
        بدون بيانات تعريفية لأنها جزء من حسابات الحملة. <strong>لا يمكن التراجع عن هذا الإجراء.</strong>
      </p>
      ${needsPin ? `
      <div class="form-group">
        <label class="form-label" for="del-acc-pin">رمز الدخول للتأكيد</label>
        <input type="password" id="del-acc-pin" class="form-input" maxlength="20" autocomplete="current-password" dir="ltr" style="text-align:center">
      </div>` : `
      <div class="form-group">
        <label class="form-label" for="del-acc-confirm">اكتب كلمة «حذف» للتأكيد</label>
        <input type="text" id="del-acc-confirm" class="form-input" autocomplete="off" style="text-align:center">
      </div>`}
      <button class="btn btn-danger w-full" data-primary onclick="App.submitDeleteAccount()">حذف حسابي نهائياً</button>
      <button class="btn btn-ghost w-full" style="margin-top:8px" onclick="App.closeModal()">إلغاء</button>
      <p class="text-center text-xs" style="margin-top:10px"><a href="/privacy.html#delete" target="_blank" rel="noopener">ماذا يُحذف بالضبط؟</a></p>`);
  },

  async submitDeleteAccount() {
    const user = Auth.currentUser();
    if (!user) return;
    const pin  = document.getElementById('del-acc-pin')?.value.trim();
    const word = document.getElementById('del-acc-confirm')?.value.trim();
    if (user.role !== 'donor' && !pin) return this.toast('أدخل رمز الدخول للتأكيد', 'error');
    if (user.role === 'donor' && word !== 'حذف') return this.toast('اكتب كلمة «حذف» للتأكيد', 'error');
    try {
      await API.req('DELETE', '/api/auth/me', pin ? { confirm: 'DELETE', pin } : { confirm: 'DELETE' });
      SyncQueue.clear();
      DB.logout();
      this.closeModal();
      this.navigate('landing');
      this.toast('تم حذف حسابك', 'info');
    } catch (e) {
      this.toast(e.message || 'تعذر حذف الحساب', 'error');
    }
  },

  async handleLogout() {
    if (this._loggingOut) return;
    let pending = SyncQueue.pendingCount();
    const ask = pending
      ? `لديك ${pending} تغيير لم يُحفظ على الخادم بعد. سنحاول حفظه الآن ثم تسجيل الخروج. متابعة؟`
      : 'تسجيل الخروج من حسابك؟';
    if (!confirm(ask)) return;
    this._loggingOut = true;
    try {
      if (pending) {
        await Promise.race([SyncQueue.flushNow(), new Promise(r => setTimeout(r, 5000))]);
        pending = SyncQueue.pendingCount();
        if (pending && !confirm(`تعذر حفظ ${pending} تغيير (لا يوجد اتصال). الخروج الآن سيحذفها من هذا الجهاز. هل تريد الخروج؟`)) return;
      }
      await Auth.logout();
      this.toast('تم تسجيل الخروج');
      this.navigate('landing');
    } finally {
      this._loggingOut = false;
    }
  },

  // ─────────────────────────────────────────────────────────────
  // NEW CAMPAIGN REGISTRATION
  // ─────────────────────────────────────────────────────────────
  renderNewCampaign() {
    const view = this._show('view-newcampaign');
    view.innerHTML = `
      <div class="container">
        <div class="card fade-up" style="margin-bottom:20px;background:linear-gradient(135deg,var(--primary) 0%,var(--primary-dark) 100%);border:none;color:white;text-align:center;padding:32px 24px">
          <div class="nc-hero-icon">${Icons.star}</div>
          <h2 style="color:white;margin-bottom:8px">ابدأ حملتك على منصة ومن أحياها</h2>
          <p style="color:rgba(255,255,255,.85);font-size:.95rem;margin:0">نرحب بكل من يريد إطلاق حملة تبرعات جديدة. نحن هنا لمساعدتك!</p>
        </div>

        <!-- ============================================
             دليل إطلاق الحملة — يمكنك تعديل هذا النص بحرية
             ============================================ -->
        <div class="card fade-up delay-1" style="margin-bottom:20px">
          <h4 style="margin-bottom:16px;color:var(--primary);display:flex;align-items:center;gap:6px"><span class="icon icon-sm">${Icons.book}</span> كيف تبدأ حملتك؟</h4>
          <div id="campaign-guide-content" style="line-height:2;color:var(--text-body);font-size:.95rem">
            <!-- غيّر هذا النص! اكتب دليلك الخاص هنا -->
            <p><strong>1. الخطوة الأولى:</strong> تواصل معنا عبر النموذج أدناه أو مباشرةً عبر الواتساب. سنرشدك خطوة بخطوة.</p>
            <p><strong>2. الخطوة الثانية:</strong> حدّد المجموعة الجامعية أو الفريق الذي سيدير الحملة معك.</p>
            <p><strong>3. الخطوة الثالثة:</strong> نقوم بإعداد المنصة لك وإضافة جامعي التبرعات والمتبرعين.</p>
            <p style="color:var(--primary);font-weight:700;display:flex;align-items:center;gap:6px"><span class="icon icon-sm">${Icons.bulb}</span> العملية سهلة وبسيطة! لا تتردد في التواصل معنا.</p>
          </div>
        </div>
        <!-- ============================================ -->

        <div class="card fade-up delay-2" style="margin-bottom:20px">
          <h4 style="margin-bottom:16px;color:var(--text-heading);display:flex;align-items:center;gap:6px"><span class="icon icon-sm">${Icons.mail}</span> تواصل معنا</h4>
          <p class="text-muted" style="font-size:.9rem;margin-bottom:16px">املأ النموذج وسنتواصل معك لمساعدتك في إطلاق حملتك.</p>
          <div class="form-group">
            <label class="form-label">الاسم الكامل</label>
            <input type="text" id="camp-name" class="form-input" placeholder="اسمك الكريم">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="tel" id="camp-phone" class="form-input" placeholder="07xxxxxxxxx" dir="ltr" style="text-align:center">
          </div>
          <div class="form-group">
            <label class="form-label">فكرة الحملة / رسالتك</label>
            <textarea id="camp-message" class="form-input" rows="4" placeholder="اكتب فكرة حملتك أو أي سؤال لديك..."></textarea>
          </div>
          <button class="btn btn-primary w-full" onclick="App.submitCampaignRequest()">إرسال الطلب</button>
        </div>

        <div class="card fade-up delay-3" style="margin-bottom:20px;text-align:center">
          <p class="text-muted" style="margin-bottom:12px;font-size:.9rem">أو تواصل معنا مباشرةً:</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a href="https://wa.me/9647777961845?text=${encodeURIComponent('السلام عليكم\nأريد بدء حملة كفالة جديدة على منصة ومن أحياها')}" target="_blank" class="wa-btn wa-btn-whatsapp">
              <span class="icon icon-sm">${Icons.whatsapp}</span> واتساب
            </a>
            <a href="https://t.me/+9647777961845" target="_blank" class="wa-btn wa-btn-telegram">
              <span class="icon icon-sm">${Icons.telegram}</span> تيليجرام
            </a>
          </div>
        </div>

        <button class="btn btn-ghost w-full" onclick="App.navigate('landing')" style="margin-bottom:20px">← العودة للصفحة الرئيسية</button>
      </div>`;
  },

  submitCampaignRequest() {
    const name = document.getElementById('camp-name').value.trim();
    const phone = document.getElementById('camp-phone').value.trim();
    const message = document.getElementById('camp-message').value.trim();
    if (!name || !phone) return this.toast('الرجاء ملء الاسم ورقم الهاتف', 'error');
    DB.saveCampaignRequest({ name, phone, message });
    this.toast('تم إرسال طلبك بنجاح! سنتواصل معك قريباً.');
    document.getElementById('camp-name').value = '';
    document.getElementById('camp-phone').value = '';
    document.getElementById('camp-message').value = '';
  },

  // ─────────────────────────────────────────────────────────────
  // ABOUT THE PLATFORM + SUPPORT (tab "عن المنصة")
  // ─────────────────────────────────────────────────────────────
  renderInstitution() {
    const view = this._show('view-institution');
    const steps = [
      [Icons.heart,  'تعهّد شهري واضح',      'كل متبرع يحدد مبلغه الشهري، ويرى حالة تبرعه لكل شهر في جدول الحملة.'],
      [Icons.users,  'مسؤول جمع لكل متبرع',   'يستلم مسؤول الجمع التبرعات ويؤكدها في الجدول، فتظهر فوراً لإدارة الحملة.'],
      [Icons.chart,  'شفافية ومنافسة إيجابية', 'نسبة إنجاز كل حملة وعدد الأيتام المكفولين أمام الجميع، مع تذكيرات عبر تليجرام.'],
    ];

    view.innerHTML = `
      <div class="container">
        <div class="card fade-up about-hero">
          <div class="about-hero-icon">${Icons.heart}</div>
          <h3>ومن أحياها</h3>
          <p class="about-verse">﴿وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا﴾</p>
          <p class="about-lead">منصة لتنظيم حملات الكفالة الشهرية للأيتام التي يديرها طلاب الجامعات: المتبرع يعرف أين وصل تبرعه، ومسؤول الجمع يتابع قائمته بسهولة.</p>
        </div>

        <div class="section-header fade-up delay-1"><h4 class="section-title">كيف تعمل المنصة</h4></div>
        ${steps.map(([icon, title, desc]) => `
          <div class="card fade-up delay-1 about-step">
            <div class="about-step-icon">${icon}</div>
            <div>
              <div class="about-step-title">${title}</div>
              <p class="text-sm">${desc}</p>
            </div>
          </div>`).join('')}

        <div class="card fade-up delay-2" style="margin:20px 0;text-align:center">
          <p class="text-muted" style="margin-bottom:12px;font-size:.9rem">تريد إطلاق حملة كفالة في جامعتك؟</p>
          <button class="btn btn-primary w-full" onclick="App.navigate('newcampaign')">
            <span class="icon icon-sm icon-white">${Icons.star}</span> ابدأ حملة جديدة
          </button>
        </div>

        <div class="card fade-up delay-3" style="margin-bottom:20px;border-top:3px solid var(--gold)">
          <h4 style="margin-bottom:6px;color:var(--text-heading);display:flex;align-items:center;gap:6px"><span class="icon icon-sm" style="color:var(--text-body)">${Icons.mail}</span> تواصل مع إدارة المنصة</h4>
          <p class="text-sm text-muted" style="margin-bottom:16px">اكتب سؤالك أو ملاحظتك هنا. تصل الرسالة إلى إدارة المنصة فقط.</p>
          <div class="form-group">
            <textarea id="support-msg" class="form-input" rows="3" placeholder="اكتب رسالتك هنا..."></textarea>
          </div>
          <button class="btn btn-gold w-full" onclick="App.submitSupportMessage()">إرسال الرسالة</button>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
            <a href="https://wa.me/9647777961845" target="_blank" rel="noopener" class="wa-btn wa-btn-whatsapp">
              <span class="icon icon-sm">${Icons.whatsapp}</span> واتساب
            </a>
            <a href="https://t.me/+9647777961845" target="_blank" rel="noopener" class="wa-btn wa-btn-telegram">
              <span class="icon icon-sm">${Icons.telegram}</span> تيليجرام
            </a>
          </div>
        </div>

        <p class="text-center text-xs" style="margin-bottom:20px">
          <a href="/privacy.html" target="_blank" rel="noopener">سياسة الخصوصية</a>
        </p>

        ${this._renderSupportInbox()}
      </div>`;
  },

  submitSupportMessage() {
    const user = Auth.currentUser();
    const text = document.getElementById('support-msg').value.trim();
    if (!text) return this.toast('اكتب رسالتك أولاً', 'error');
    DB.saveSupportMessage({
      senderName: user ? user.name : 'زائر',
      senderPhone: user ? user.phone : '',
      senderId: user ? user.id : '',
      text,
    });
    this.toast('تم إرسال رسالتك بنجاح. سيتم الرد عليك قريباً.');
    document.getElementById('support-msg').value = '';
  },

  _renderCampaignRequests() {
    const reqs = DB.getCampaignRequests().slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!reqs.length) return '';
    return `
      <div class="card" style="margin-bottom:20px;border-top:3px solid var(--gold)">
        <h4 style="margin-bottom:14px;display:flex;align-items:center;gap:6px"><span class="icon icon-sm">${Icons.inbox}</span> طلبات تأسيس حملات جديدة (${this.fmt(reqs.length)})</h4>
        ${reqs.map(r => `
          <div style="background:var(--gray-50);border-radius:var(--r-sm);padding:12px;margin-bottom:10px;border:1px solid var(--border)">
            <div class="flex-between" style="margin-bottom:6px">
              <span style="font-weight:700;font-size:.9rem;color:var(--text-heading)">${this.esc(r.name)}</span>
              <span class="text-xs text-muted">${this.timeAgo(r.createdAt)}</span>
            </div>
            ${r.message ? `<p style="font-size:.9rem;color:var(--text-body);line-height:1.8;margin-bottom:8px">${this.esc(r.message)}</p>` : ''}
            <a href="https://wa.me/${App.intlPhone(r.phone)}" target="_blank" class="text-xs" dir="ltr">${this.esc(r.phone)}</a>
          </div>`).join('')}
      </div>`;
  },

  _renderSupportInbox() {
    const user = Auth.currentUser();
    if (!user) return '';
    const campaignRequests = user.role === 'superadmin' ? this._renderCampaignRequests() : '';

    const isAdminOrSupport = user.role === 'admin' || user.role === 'superadmin';

    let msgs = DB.getSupportMessages().reverse();
    if (!isAdminOrSupport) {
      msgs = msgs.filter(m => m.senderId === user.id);
    }

    if (msgs.length === 0) {
      if (isAdminOrSupport) return campaignRequests + `<div class="card" style="margin-bottom:20px;text-align:center;padding:20px"><p class="text-muted">لا توجد رسائل دعم حالياً.</p></div>`;
      return '';
    }

    return campaignRequests + `
      <div class="card" style="margin-bottom:20px;border-top:3px solid var(--danger)">
        <h4 style="margin-bottom:14px;color:var(--danger);display:flex;align-items:center;gap:6px"><span class="icon icon-sm">${Icons.inbox}</span> صندوق رسائل الدعم (${this.fmt(msgs.length)})</h4>
        ${msgs.map(m => `
          <div style="background:var(--gray-50);border-radius:var(--r-sm);padding:12px;margin-bottom:10px;border:1px solid var(--border)">
            <div class="flex-between" style="margin-bottom:6px">
              <span style="font-weight:700;font-size:.9rem;color:var(--text-heading)">${this.esc(m.senderName)}</span>
              <span class="text-xs text-muted">${this.timeAgo(m.createdAt)}</span>
            </div>
            <p style="font-size:.9rem;color:var(--text-body);line-height:1.8;margin-bottom:8px">${this.esc(m.text)}</p>
            <div class="flex-between">
              <span class="text-xs text-muted">${this.esc(m.senderPhone || 'بدون رقم')}</span>
              ${isAdminOrSupport ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger);font-size:.75rem" onclick="if(confirm('حذف هذه الرسالة؟')){DB.deleteSupportMessage('${m.id}');App.renderInstitution()}">حذف</button>` : '<span></span>'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  toggleGPS(turnOn) {
    const user = Auth.currentUser();
    if (!turnOn) {
      user.liveLocation = { active: false };
      DB.saveUser(user);
      DB.setCurrentUser(user.id);
      this.toast('تم إيقاف إعلان التواجد.', 'success');
      if (document.getElementById('view-profile').classList.contains('active')) this.renderProfile();
      return;
    }

    if (!navigator.geolocation) {
      return this.toast('المتصفح لا يدعم تحديد الموقع.', 'error');
    }

    this.toast('جاري تحديد الموقع...', 'warning');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      
      user.liveLocation = { active: true, lat, lng, updatedAt: new Date().toISOString() };
      DB.saveUser(user);
      DB.setCurrentUser(user.id);
      this.toast('تم تحديد الموقع! جاري إشعار المتبرعين...', 'success');
      if (document.getElementById('view-profile').classList.contains('active')) this.renderProfile();

      const donors = DB.getUsersByCollector(user.id).filter(d => d.telegramChatId);
      if (donors.length > 0) {
        try {
          const group = DB.getGroup(user.groupId);
          await API.post('/api/notify-location', {
            chatIds: donors.map(d => d.telegramChatId),
            collectorName: user.name,
            lat, lng,
          });
        } catch(e) {}
      }
    }, (err) => {
      this.toast('فشل تحديد الموقع. تأكد من تفعيل الـ GPS.', 'error');
    }, { enableHighAccuracy: true });
  },

  // ─────────────────────────────────────────────────────────
  // NEW SUPER ADMIN CAMPAIGN MODAL
  // ─────────────────────────────────────────────────────────
  showSuperAdminCreateCampaignModal() {
    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="flex:1;text-align:center">إنشاء حملة جديدة</div>
      </div>
      <div style="padding:0 4px">
        <div class="form-group">
          <label class="form-label">اسم الحملة (المجموعة)</label>
          <input type="text" id="new-camp-name" class="form-input" placeholder="مثال: مجموعة كلية الطب">
        </div>
        <div class="form-group">
          <label class="form-label">اسم الجامعة / الكلية</label>
          <input type="text" id="new-camp-uni" class="form-input" placeholder="مثال: جامعة بغداد">
        </div>
        <div style="display:flex;gap:12px">
          <div class="form-group" style="flex:1">
            <label class="form-label">الأيتام المكفولين</label>
            <input type="number" inputmode="numeric" id="new-camp-orphans" class="form-input" value="1" min="1" dir="ltr" style="text-align:center">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">كلفة اليتيم (د.ع)</label>
            <input type="number" inputmode="numeric" id="new-camp-cost" class="form-input" value="25000" min="5000" step="5000" dir="ltr" style="text-align:center">
          </div>
        </div>
        
        <div style="margin:20px 0;border-top:1px dashed var(--border);padding-top:16px">
          <div style="font-weight:700;margin-bottom:12px;color:var(--text-heading);display:flex;align-items:center;gap:8px">
            <span class="icon icon-sm" style="color:var(--primary)">${Icons.user}</span> بيانات مدير الحملة الأول
          </div>
          <div class="form-group">
            <label class="form-label">اسم المدير</label>
            <input type="text" id="new-camp-admin-name" class="form-input" placeholder="الاسم الكامل">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="tel" id="new-camp-admin-phone" class="form-input" placeholder="07xxxxxxxxx" dir="ltr" style="text-align:center">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">رمز الدخول (PIN)</label>
            <input type="password" id="new-camp-admin-pin" class="form-input" placeholder="4 أرقام أو أكثر" maxlength="20" inputmode="numeric" autocomplete="new-password" dir="ltr" style="text-align:center;letter-spacing:4px">
          </div>
        </div>

        <div style="margin:20px 0;border-top:1px dashed var(--border);padding-top:16px">
          <div style="font-weight:700;margin-bottom:12px;color:var(--text-heading);display:flex;align-items:center;gap:8px">
            <span class="icon icon-sm" style="color:var(--primary)">${Icons.telegram}</span> توكن بوت التليجرام
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">توكن البوت الخاص بالحملة</label>
            <input type="text" id="new-camp-bot-token" class="form-input" placeholder="123456:ABC-DEFxxxxxxxxxxxxxxx" dir="ltr" style="font-size:.8rem">
            <div class="form-hint" style="margin-top:4px;color:var(--text-muted);font-size:.78rem">اختياري — أنشئ بوتاً عبر @BotFather وألصق توكنه هنا، أو أضفه لاحقاً من إعدادات الحملة. إذا تُرك فارغاً يُستخدم البوت الافتراضي للمنصة.</div>
          </div>
        </div>
      </div>
      <div style="margin-top:24px;display:flex;gap:12px">
        <button class="btn btn-outline" style="flex:1" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-primary" style="flex:2" onclick="App.submitSuperAdminCreateCampaign()">إنشاء واعتماد الحملة</button>
      </div>
    `);
  },

  async submitSuperAdminCreateCampaign() {
    const groupName = document.getElementById('new-camp-name').value.trim();
    const uni = document.getElementById('new-camp-uni').value.trim();
    const orphansCount = parseInt(document.getElementById('new-camp-orphans').value) || 1;
    const cost = parseInt(document.getElementById('new-camp-cost').value) || 25000;

    const adminName = document.getElementById('new-camp-admin-name').value.trim();
    const adminPhone = document.getElementById('new-camp-admin-phone').value.trim();
    const adminPin = document.getElementById('new-camp-admin-pin').value.trim();

    if (!groupName || !uni || !adminName || !adminPhone) {
      return this.toast('الرجاء ملء جميع الحقول الأساسية', 'error');
    }
    if (adminPin.length < 4) {
      return this.toast('رمز الدخول يجب أن يكون 4 أرقام على الأقل', 'error');
    }

    const submitBtn = document.querySelector('.modal button.btn-primary');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الإنشاء…'; }

    let serverGroup = null;
    try {
      // 1) Create the group on the server — get the real server-assigned ID back.
      const gRes = await API.post('/api/groups', {
        name:             groupName,
        university:       uni,
        orphansSponsored: orphansCount,
        costPerOrphan:    cost,
      });
      if (!gRes?.success || !gRes.group) {
        throw new Error(gRes?.error || 'فشل إنشاء الحملة');
      }
      serverGroup = gRes.group;

      // 2) Create the admin user attached to that group.
      const uRes = await API.post('/api/users', {
        name:    adminName,
        phone:   adminPhone,
        role:    'admin',
        pin:     adminPin,
        groupId: serverGroup.id,
      });
      if (!uRes?.success || !uRes.user) {
        // Group succeeded but admin failed — roll back the group so we don't
        // leave an orphan campaign with no admin attached.
        try { await API.del('/api/groups/' + serverGroup.id); serverGroup = null; } catch {}
        throw new Error(uRes?.error || 'فشل إنشاء المدير');
      }

      // 3) Hydrate local cache from the server-shape rows (NOT the form inputs),
      //    marked _noSync so we don't echo them back through SyncQueue.
      DB.saveGroup({
        ...serverGroup,
        orphansSponsored: serverGroup.orphans_sponsored,
        costPerOrphan:    serverGroup.cost_per_orphan,
        monthlyGoal:      serverGroup.monthly_goal,
        _noSync: true,
      });
      DB.saveUser({
        ...uRes.user,
        groupId:     uRes.user.group_id,
        collectorId: uRes.user.collector_id,
        _noSync: true,
      });

      // Optional campaign bot: a bad token must not undo a created campaign.
      const botToken = (document.getElementById('new-camp-bot-token')?.value || '').trim();
      let botNote = '';
      if (botToken) {
        try {
          const b = await API.post(`/api/groups/${serverGroup.id}/bot-token`, { botToken });
          botNote = ` — البوت @${b.username} مفعّل`;
          await DB.refreshGroups();
        } catch (e) {
          this.toast('تم إنشاء الحملة، لكن توكن البوت لم يُقبل: ' + (e.message || '') + ' — يمكنك إضافته من إعدادات الحملة', 'warning');
        }
      }

      this.closeModal();
      this.toast('تم إنشاء الحملة بنجاح!' + botNote);
      this.renderHome();
    } catch (err) {
      const msg = err.message || 'فشل إنشاء الحملة';
      // Defence-in-depth: if the admin POST itself threw (network or API.req error),
      // serverGroup may still be set. Roll it back so we never leave an orphan group.
      if (serverGroup) {
        try { await API.del('/api/groups/' + serverGroup.id); } catch {}
      }
      // msg is already translated to Arabic by apiClient → Errors.t.
      this.toast(msg, 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'إنشاء واعتماد الحملة'; }
    }
  },

  // ─────────────────────────────────────────────────────────
  // TELEGRAM BOT SETTINGS — a campaign's own bot, or (groupId = null)
  // the platform default bot used by campaigns without their own.
  // ─────────────────────────────────────────────────────────
  async showTelegramBotModal(groupId = null) {
    const isDefault = !groupId;
    const group = groupId ? DB.getGroup(groupId) : null;
    const title = isDefault ? 'بوت التليجرام الافتراضي للمنصة' : 'بوت التليجرام للحملة';
    this._openModal(`
      <div class="modal-header"><div class="modal-title">${title}</div></div>
      <div id="tgbot-body" class="text-center text-muted" style="padding:24px">جاري التحميل…</div>`);

    let st;
    try {
      st = isDefault ? await API.get('/api/telegram/default-bot')
                     : await API.get(`/api/groups/${encodeURIComponent(groupId)}/telegram`);
    } catch (e) {
      this.closeModal();
      return this.toast(e.message || 'تعذر تحميل إعدادات البوت', 'error');
    }
    const body = document.getElementById('tgbot-body');
    if (!body) return;

    const current  = isDefault ? (st.connected ? st.username : null) : st.ownBot;
    const fallback = isDefault ? null : st.defaultBot;
    const botLink  = (u) => `<a href="https://t.me/${encodeURIComponent(u)}" target="_blank" rel="noopener" dir="ltr">@${this.esc(u)}</a>`;

    let statusHtml;
    if (current) {
      statusHtml = `<div class="tg-status tg-status-ok"><span class="icon icon-sm">${Icons.check}</span>
        <div><div style="font-weight:700">البوت مفعّل: ${botLink(current)}</div>
        <div class="text-xs">${isDefault
          ? (st.source === 'env' ? 'مضبوط من ملف إعدادات الخادم. أي توكن تحفظه هنا يحل محله.' : 'تستخدمه الحملات التي ليس لها بوت خاص.')
          : 'التذكيرات والإيصالات وربط حسابات المتبرعين تتم عبر هذا البوت.'}</div></div></div>`;
    } else if (fallback) {
      statusHtml = `<div class="tg-status tg-status-info"><span class="icon icon-sm">${Icons.telegram}</span>
        <div><div style="font-weight:700">تستخدم الحملة بوت المنصة ${botLink(fallback)}</div>
        <div class="text-xs">يمكنك إضافة بوت خاص باسم حملتك بدلاً منه.</div></div></div>`;
    } else {
      statusHtml = `<div class="tg-status tg-status-warn"><span class="icon icon-sm">${Icons.telegram}</span>
        <div><div style="font-weight:700">لا يوجد بوت مفعّل</div>
        <div class="text-xs">تذكيرات التليجرام والإيصالات وربط حسابات المتبرعين متوقفة حتى تضيف بوتاً.</div></div></div>`;
    }

    body.className = '';
    body.style.padding = '0';
    body.innerHTML = `
      ${group ? `<div class="text-sm text-muted" style="margin-bottom:12px;text-align:center">${this.esc(group.name)}</div>` : ''}
      ${statusHtml}
      <details class="tg-howto" ${current ? '' : 'open'}>
        <summary>كيف أحصل على توكن البوت؟ (دقيقة واحدة)</summary>
        <ol>
          <li>افتح تليجرام وابحث عن <a href="https://t.me/BotFather" target="_blank" rel="noopener" dir="ltr">@BotFather</a> (عليه علامة التوثيق الزرقاء).</li>
          <li>أرسل له الأمر <code dir="ltr">/newbot</code> ثم اكتب اسماً للبوت، ثم معرّفاً إنكليزياً ينتهي بـ <code dir="ltr">bot</code>.</li>
          <li>سيرسل لك رسالة فيها التوكن مثل <code dir="ltr">123456789:AAH…</code> — انسخه كاملاً وألصقه في الأسفل.</li>
        </ol>
      </details>
      <div class="form-group">
        <label class="form-label" for="tgbot-token">${current ? 'استبدال التوكن' : 'توكن البوت'}</label>
        <input type="text" id="tgbot-token" class="form-input" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="123456789:AAH..." style="font-size:.85rem;text-align:left"
               onkeyup="if(event.key==='Enter')App.saveTelegramBot(${groupId ? `'${this.esc(groupId)}'` : 'null'})">
        <div class="text-xs text-muted" style="margin-top:6px">نتحقق من التوكن مع تليجرام قبل الحفظ، ويُحفظ مشفّراً ولا يظهر لأحد بعدها.</div>
      </div>
      <button id="tgbot-save" class="btn btn-primary w-full" onclick="App.saveTelegramBot(${groupId ? `'${this.esc(groupId)}'` : 'null'})">
        <span class="icon icon-sm icon-white">${Icons.telegram}</span> حفظ وتفعيل البوت
      </button>
      ${current && !(isDefault && st.source === 'env') ? `
      <button id="tgbot-remove" class="btn btn-ghost w-full" style="margin-top:8px;color:var(--danger)" onclick="App.removeTelegramBot(${groupId ? `'${this.esc(groupId)}'` : 'null'})">
        إزالة البوت${isDefault ? '' : (fallback ? ' (والرجوع لبوت المنصة)' : '')}
      </button>` : ''}
      <button class="btn btn-outline w-full" style="margin-top:8px" onclick="App.closeModal()">إغلاق</button>`;
    setTimeout(() => { if (!current) document.getElementById('tgbot-token')?.focus(); }, 100);
  },

  async saveTelegramBot(groupId = null) {
    const token = (document.getElementById('tgbot-token')?.value || '').trim();
    if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token)) {
      return this.toast('التوكن غير صحيح — انسخه كاملاً من رسالة BotFather', 'error');
    }
    const btn = document.getElementById('tgbot-save');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التحقق من التوكن…'; }
    try {
      const r = groupId
        ? await API.post(`/api/groups/${encodeURIComponent(groupId)}/bot-token`, { botToken: token })
        : await API.post('/api/telegram/default-bot', { botToken: token });
      await DB.refreshGroups();
      this.toast(`تم تفعيل البوت @${r.username} ✓`);
      this.showTelegramBotModal(groupId);
    } catch (e) {
      this.toast(e.message || 'تعذر حفظ التوكن', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<span class="icon icon-sm icon-white">${Icons.telegram}</span> حفظ وتفعيل البوت`; }
    }
  },

  async removeTelegramBot(groupId = null) {
    if (!confirm('إزالة هذا البوت؟ لن تصل التذكيرات عبره بعد الآن.')) return;
    const btn = document.getElementById('tgbot-remove');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الإزالة…'; }
    try {
      if (groupId) await API.del(`/api/groups/${encodeURIComponent(groupId)}/bot-token`);
      else await API.del('/api/telegram/default-bot');
      await DB.refreshGroups();
      this.toast('تمت إزالة البوت');
      this.showTelegramBotModal(groupId);
    } catch (e) {
      this.toast(e.message || 'تعذرت الإزالة', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'إزالة البوت'; }
    }
  },

  // ─────────────────────────────────────────────────────────
  // SUPER ADMIN — CAMPAIGN SETTINGS / FULL DELETE
  // ─────────────────────────────────────────────────────────
  showCampaignSettingsModal(groupId) {
    const group = DB.getGroup(groupId);
    if (!group) return this.toast('الحملة غير موجودة', 'error');

    // Counts pulled from local cache for transparency before destructive op.
    const admins     = DB.getAdminsByGroup(groupId).length;
    const collectors = DB.getCollectorsByGroup(groupId).length;
    const donors     = DB.getDonorsByGroup(groupId).length;
    const orphans    = DB.getOrphansByGroup(groupId).length;
    const anns       = DB.getAnnouncementsByGroup(groupId).length;

    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="flex:1;text-align:center">إعدادات الحملة</div>
      </div>
      <div style="padding:0 4px">
        <div style="background:var(--primary-bg);padding:14px;border-radius:var(--r-md);margin-bottom:16px">
          <div style="font-weight:700;font-size:1.05rem;color:var(--text-heading);margin-bottom:4px">${this.esc(group.name)}</div>
          <div class="text-sm text-muted">${this.esc(group.university || '')}</div>
        </div>

        <div class="settings-row">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="icon icon-sm" style="color:var(--primary)">${Icons.telegram}</span>
            <div style="min-width:0">
              <div style="font-weight:700">بوت التليجرام</div>
              <div class="text-xs text-muted" dir="auto">${group.botUsername ? '@' + this.esc(group.botUsername) : 'غير مفعّل'}</div>
            </div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="App.showTelegramBotModal('${groupId}')">إدارة</button>
        </div>

        <div style="margin-top:24px;border:1px solid var(--danger);border-radius:var(--r-md);padding:14px;background:rgba(220,38,38,.04)">
          <div style="font-weight:700;color:var(--danger);margin-bottom:8px">⚠️ منطقة الخطر</div>
          <p class="text-sm text-muted" style="margin-bottom:6px">
            حذف الحملة بالكامل سيؤدي إلى إزالة:
          </p>
          <ul class="text-sm" style="margin:0 18px 12px;padding:0;line-height:1.8">
            <li>${this.fmt(admins)} مدير، ${this.fmt(collectors)} مسؤول جمع، ${this.fmt(donors)} متبرع</li>
            <li>${this.fmt(orphans)} يتيم مكفول</li>
            <li>${this.fmt(anns)} إعلان</li>
            <li>جميع سجلات التبرعات لهذه الحملة</li>
          </ul>
          <p class="text-sm" style="color:var(--danger);font-weight:700;margin-bottom:12px">لا يمكن التراجع عن هذا الإجراء.</p>
          <button class="btn btn-danger w-full" onclick="App.confirmFullDeleteCampaign('${groupId}')">
            <span class="icon icon-sm">${Icons.trash}</span> حذف الحملة بالكامل
          </button>
        </div>
      </div>
      <div style="margin-top:20px">
        <button class="btn btn-outline w-full" onclick="App.closeModal()">إغلاق</button>
      </div>
    `);
  },

  confirmFullDeleteCampaign(groupId) {
    const group = DB.getGroup(groupId);
    if (!group) return;

    this._openModal(`
      <div class="modal-header">
        <div class="modal-title" style="flex:1;text-align:center;color:var(--danger)">تأكيد حذف الحملة</div>
      </div>
      <div style="padding:0 4px">
        <div style="background:rgba(220,38,38,.08);border:1px solid var(--danger);padding:14px;border-radius:var(--r-md);margin-bottom:16px">
          <div style="font-weight:700;color:var(--danger);margin-bottom:6px">⚠️ تحذير نهائي</div>
          <p class="text-sm">سيتم حذف الحملة <strong>"${this.esc(group.name)}"</strong> وجميع بياناتها بشكل نهائي.</p>
        </div>
        <div class="form-group">
          <label class="form-label">أدخل رمز الدخول الخاص بك للتأكيد</label>
          <input type="password" id="del-camp-pin" class="form-input" placeholder="••••" maxlength="20"
                 autocomplete="current-password"
                 style="text-align:center;font-size:1.25rem;letter-spacing:4px"
                 onkeyup="if(event.key==='Enter')App.submitFullDeleteCampaign('${groupId}')">
        </div>
      </div>
      <div style="margin-top:20px;display:flex;gap:12px">
        <button class="btn btn-outline" style="flex:1" onclick="App.closeModal()">إلغاء</button>
        <button class="btn btn-danger" style="flex:2" onclick="App.submitFullDeleteCampaign('${groupId}')">
          حذف الحملة نهائياً
        </button>
      </div>
    `);
    setTimeout(() => document.getElementById('del-camp-pin')?.focus(), 100);
  },

  async submitFullDeleteCampaign(groupId) {
    const pinInput = document.getElementById('del-camp-pin');
    const pin = pinInput ? pinInput.value.trim() : '';
    if (!pin) return this.toast('الرجاء إدخال رمز الدخول', 'error');

    const btn = document.querySelector('.modal button.btn-danger');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري الحذف…'; }

    try {
      const res = await API.post('/api/groups/' + groupId + '/full-delete', { pin });
      if (!res?.success) throw new Error(res?.error || 'فشل الحذف');

      // Purge local cache so the next render doesn't show ghost rows.
      const groups = DB.getGroups(); delete groups[groupId]; DB._set(DB.KEYS.GROUPS, groups);
      const users  = DB.getUsers();
      Object.keys(users).forEach(uid => {
        const u = users[uid];
        if ((u.groupId || u.group_id) === groupId) delete users[uid];
      });
      DB._set(DB.KEYS.USERS, users);
      const anns  = DB.getAnnouncements().filter(a => (a.groupId || a.group_id) !== groupId);
      DB._setArray(DB.KEYS.ANNOUNCEMENTS, anns);
      const orphs = DB.getOrphans().filter(o => (o.groupId || o.group_id) !== groupId);
      localStorage.setItem(DB.KEYS.ORPHANS, JSON.stringify(orphs));
      const dons  = DB.getDonations(); delete dons[groupId]; DB._set(DB.KEYS.DONATIONS, dons);

      this.closeModal();
      this.toast('تم حذف الحملة بالكامل');
      this.renderHome();
    } catch (err) {
      // err.message is already Arabic via apiClient → Errors.t
      this.toast(err.message || 'فشل الحذف', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'حذف الحملة نهائياً'; }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
