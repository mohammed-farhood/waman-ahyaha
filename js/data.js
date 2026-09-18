/* ============================================
   WAMAN-AHYAHA DONATION TRACKER — DATA LAYER
   ============================================
   localStorage = offline cache.
   Server = source of truth.
   Mutations: optimistic local + SyncQueue push.
   Reads: synchronous from cache (pre-warmed by bootstrapData).
   ============================================ */

const DB = {
  KEYS: {
    APP_VERSION: '4.0.0',
    USERS: 'waman_users',
    GROUPS: 'waman_groups',
    DONATIONS: 'waman_donations',
    ANNOUNCEMENTS: 'waman_announcements',
    ORPHANS: 'waman_orphans',
    CURRENT_USER: 'waman_current_user',
    SETTINGS: 'waman_settings',
    CAMPAIGN_REQUESTS: 'waman_campaign_requests',
    SUPPORT_MESSAGES: 'waman_support_messages',
    PAY_REPORTS: 'waman_pay_reports',
  },

  // ── Cache primitives ───────────────────────────────────
  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
  },
  _set(key, data) { localStorage.setItem(key, JSON.stringify(data)); },
  _getArray(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  },
  _setArray(key, data) { localStorage.setItem(key, JSON.stringify(data)); },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  },

  // Called by SyncQueue after a successful create POST that carried a `reconcile` field.
  // Swaps the client-generated temp id in local cache for the real id the server assigned,
  // and normalises snake_case server fields back to camelCase for the cache.
  // Known limitation: if a delete/update for the temp id was queued AFTER the create but
  // BEFORE this reconcile ran (only possible offline), that follow-up op still carries the
  // temp id and will 404. Same limitation already exists for saveOrphan; acceptable for v1.
  _reconcile({ collection, tempId, responseField }, resp) {
    const serverRow = resp && resp[responseField];
    if (!serverRow || !serverRow.id) return;
    const key = this.KEYS[collection];
    if (!key) return;

    const normalized = this._normalize(collection, serverRow);

    const raw = localStorage.getItem(key);
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }

    if (Array.isArray(parsed)) {
      const idx = parsed.findIndex(r => r.id === tempId);
      if (idx >= 0) parsed[idx] = normalized;
      else          parsed.unshift(normalized);
      this._setArray(key, parsed);
    } else {
      const cache = parsed || {};
      if (tempId !== serverRow.id) delete cache[tempId];
      cache[serverRow.id] = normalized;
      this._set(key, cache);
    }

    // If we just renamed the currently-logged-in user, repoint CURRENT_USER too.
    if (collection === 'USERS' && tempId !== serverRow.id) {
      const cur = localStorage.getItem(this.KEYS.CURRENT_USER);
      if (cur === tempId) localStorage.setItem(this.KEYS.CURRENT_USER, serverRow.id);
    }
  },

  // ── Server rows → the camelCase shape the UI reads ────
  // The API returns snake_case columns; every server row goes through one of these
  // before it is cached. Snake_case keys are kept too (harmless, and some code reads them).
  normUser(u) {
    if (!u) return u;
    return {
      ...u,
      groupId:        u.group_id         !== undefined ? u.group_id         : (u.groupId ?? null),
      collectorId:    u.collector_id     !== undefined ? u.collector_id     : (u.collectorId ?? null),
      isAnonymous:    u.is_anonymous     !== undefined ? !!u.is_anonymous   : !!u.isAnonymous,
      telegramChatId: u.telegram_chat_id !== undefined ? u.telegram_chat_id : (u.telegramChatId ?? null),
      joinDate:       u.join_date        !== undefined ? u.join_date        : u.joinDate,
    };
  },
  normGroup(g) {
    if (!g) return g;
    return {
      ...g,
      orphansSponsored: g.orphans_sponsored ?? g.orphansSponsored ?? 0,
      costPerOrphan:    g.cost_per_orphan   ?? g.costPerOrphan    ?? 25000,
      monthlyGoal:      g.monthly_goal      ?? g.monthlyGoal      ?? 0,
      defaultPledge:    g.default_pledge    ?? g.defaultPledge    ?? 5000,
      createdAt:        g.created_at        ?? g.createdAt,
      botUsername:      g.bot_username      ?? g.botUsername      ?? null,
    };
  },
  normAnnouncement(a) {
    if (!a) return a;
    return {
      ...a,
      groupId:    a.group_id    ?? a.groupId,
      authorId:   a.author_id   ?? a.authorId,
      authorName: a.author_name ?? a.authorName,
      isPinned:   a.is_pinned   ?? a.isPinned ?? false,
      date:       a.posted_at   ?? a.date,
    };
  },
  normOrphan(o) {
    if (!o) return o;
    return { ...o, groupId: o.group_id ?? o.groupId, birthDate: o.birth_date ?? o.birthDate ?? '' };
  },
  normPayReport(r) {
    if (!r) return r;
    return {
      ...r,
      groupId:               r.group_id    ?? r.groupId,
      donorId:               r.donor_id    ?? r.donorId,
      reportedByCollectorId: r.reporter_id ?? r.reportedByCollectorId,
      monthKey:              r.month_key   ?? r.monthKey,
      acknowledged:          !!r.acknowledged,
      createdAt:             r.created_at  ?? r.createdAt,
    };
  },
  normSupportMessage(m) {
    if (!m) return m;
    return {
      ...m,
      senderName:  m.from_user    ?? m.senderName,
      senderPhone: m.phone        ?? m.senderPhone,
      senderId:    m.from_user_id ?? m.senderId,
      text:        m.body         ?? m.text,
      createdAt:   m.created_at   ?? m.createdAt,
    };
  },
  normCampaignRequest(r) {
    if (!r) return r;
    return { ...(r.payload || {}), ...r, createdAt: r.created_at ?? r.createdAt };
  },
  _normalize(collection, row) {
    switch (collection) {
      case 'PAY_REPORTS':       return this.normPayReport(row);
      case 'SUPPORT_MESSAGES':  return this.normSupportMessage(row);
      case 'CAMPAIGN_REQUESTS': return this.normCampaignRequest(row);
      case 'USERS':         return this.normUser(row);
      case 'GROUPS':        return this.normGroup(row);
      case 'ANNOUNCEMENTS': return this.normAnnouncement(row);
      case 'ORPHANS':       return this.normOrphan(row);
      default:              return { ...row };
    }
  },

  // Fetch donations for the last `DONATION_MONTHS` months in one request and replace
  // the cache for the groups covered. Superadmin (no groupId) gets every group.
  DONATION_MONTHS: 6,
  async loadDonations(groupId = null) {
    const months = this.getRecentMonths(this.DONATION_MONTHS);
    const from = months[months.length - 1];
    const r = await API.get('/api/donations?from=' + from + (groupId ? '&groupId=' + encodeURIComponent(groupId) : ''));
    if (!r?.donations) return;
    const all = this.getDonations();
    const fresh = {};
    if (groupId) fresh[groupId] = {};
    r.donations.forEach(d => {
      const g = (fresh[d.group_id] ||= {});
      const m = (g[d.month_key] ||= {});
      m[d.user_id] = { paid: d.paid, amount: d.amount, date: d.paid_date, collectorId: d.collector_id };
    });
    if (!groupId) Object.keys(all).forEach(k => delete all[k]);
    this._set(this.KEYS.DONATIONS, { ...all, ...fresh });
  },

  // ── Bootstrap: pull fresh state from server after login ─
  async bootstrapData(user) {
    try {
      const isSuperAdmin = user.role === 'superadmin';
      const gid = user.groupId || user.group_id;

      const [groupsRes, usersRes, annRes] = await Promise.all([
        API.get('/api/groups'),
        API.get('/api/users' + (gid && !isSuperAdmin ? `?groupId=${gid}` : '')),
        API.get('/api/announcements' + (gid && !isSuperAdmin ? `?groupId=${gid}` : '')),
      ]);

      if (groupsRes?.groups) {
        const groups = {};
        groupsRes.groups.forEach(g => { groups[g.id] = this.normGroup(g); });
        this._set(this.KEYS.GROUPS, groups);
      }
      if (usersRes?.users) {
        // Replace, don't merge: rows deleted on the server must disappear locally.
        const users = {};
        const me = this.getUser(user.id);
        if (me) users[me.id] = me;
        usersRes.users.forEach(u => { users[u.id] = this.normUser(u); });
        this._set(this.KEYS.USERS, users);
      }
      if (annRes?.announcements) {
        this._setArray(this.KEYS.ANNOUNCEMENTS, annRes.announcements.map(a => this.normAnnouncement(a)));
      }

      // Donations for the months the grid shows (every group for superadmin)
      if (gid || isSuperAdmin) {
        try { await this.loadDonations(isSuperAdmin ? null : gid); }
        catch (e) { console.warn('[DB] donations load failed:', e.message); }
      }

      // Lists that used to live only in this browser's localStorage
      const isStaff = ['collector', 'admin', 'superadmin'].includes(user.role);
      const isAdmin = user.role === 'admin' || isSuperAdmin;
      await Promise.all([
        isStaff && API.get('/api/pay-reports').then(r => {
          if (r?.reports) this._setArray(this.KEYS.PAY_REPORTS, r.reports.map(x => this.normPayReport(x)));
        }).catch(() => {}),
        isAdmin && API.get('/api/support-messages').then(r => {
          if (r?.messages) this._setArray(this.KEYS.SUPPORT_MESSAGES, r.messages.map(x => this.normSupportMessage(x)));
        }).catch(() => {}),
        isSuperAdmin && API.get('/api/campaign-requests').then(r => {
          if (r?.requests) this._setArray(this.KEYS.CAMPAIGN_REQUESTS, r.requests.map(x => this.normCampaignRequest(x)));
        }).catch(() => {}),
      ]);

      // Orphans
      if (gid || isSuperAdmin) {
        try {
          const r = await API.get('/api/orphans' + (gid && !isSuperAdmin ? `?groupId=${gid}` : ''));
          if (r?.orphans) this._setArray(this.KEYS.ORPHANS, r.orphans.map(o => this.normOrphan(o)));
        } catch {}
      }
    } catch (e) {
      console.warn('[DB] bootstrapData failed:', e.message);
    }
  },

  // ==============================
  // USERS
  // ==============================
  getUsers()         { return this._get(this.KEYS.USERS); },
  getUser(userId)    { return this.getUsers()[userId] || null; },
  isSuperAdmin(user) { return user && user.role === 'superadmin'; },

  // Save a user. If the row already exists locally → PUT update. Otherwise → POST create
  // (server assigns its own id; SyncQueue reconciles the temp id back to the real one).
  // Pass `_noSync: true` when you've just received the row from the server and only
  // want to populate local cache without echoing it back.
  saveUser(user) {
    if (!user.id) user.id = this.generateId();
    const { _noSync, _new, ...clean } = user;
    const users = this.getUsers();
    const exists = !!users[user.id];
    users[user.id] = clean;
    this._set(this.KEYS.USERS, users);
    if (_noSync) return clean;
    SyncQueue.enqueue(exists
      ? { method: 'PUT', path: `/api/users/${user.id}`, body: clean }
      : { method: 'POST', path: '/api/users', body: clean,
          reconcile: { collection: 'USERS', tempId: user.id, responseField: 'user' } });
    return clean;
  },

  deleteUser(userId) {
    const users = this.getUsers();
    delete users[userId];
    this._set(this.KEYS.USERS, users);
    SyncQueue.enqueue({ method: 'DELETE', path: `/api/users/${userId}` });
  },

  getUsersByGroup(groupId)      { return Object.values(this.getUsers()).filter(u => u.groupId === groupId); },
  getUsersByCollector(collId)   { return Object.values(this.getUsers()).filter(u => u.collectorId === collId && u.role === 'donor'); },
  getCollectorsByGroup(groupId) { return Object.values(this.getUsers()).filter(u => u.groupId === groupId && u.role === 'collector'); },
  getAdminsByGroup(groupId)     { return Object.values(this.getUsers()).filter(u => u.groupId === groupId && u.role === 'admin'); },
  getDonorsByGroup(groupId)     { return Object.values(this.getUsers()).filter(u => u.groupId === groupId && u.role === 'donor'); },

  // ==============================
  // GROUPS
  // ==============================
  getGroups()     { return this._get(this.KEYS.GROUPS); },
  getGroup(id)    { return this.getGroups()[id] || null; },

  // Same shape as saveUser — existence check decides PUT vs POST, server-assigned id
  // is reconciled back into local cache via SyncQueue.
  saveGroup(group) {
    if (!group.id) group.id = this.generateId();
    const { _noSync, _new, ...clean } = group;
    const groups = this.getGroups();
    const exists = !!groups[group.id];
    groups[group.id] = clean;
    this._set(this.KEYS.GROUPS, groups);
    if (_noSync) return clean;
    SyncQueue.enqueue(exists
      ? { method: 'PUT', path: `/api/groups/${group.id}`, body: clean }
      : { method: 'POST', path: '/api/groups', body: clean,
          reconcile: { collection: 'GROUPS', tempId: group.id, responseField: 'group' } });
    return clean;
  },

  deleteGroup(groupId) {
    const groups = this.getGroups();
    delete groups[groupId];
    this._set(this.KEYS.GROUPS, groups);
    SyncQueue.enqueue({ method: 'DELETE', path: `/api/groups/${groupId}` });
  },

  getAllGroupsList() { return Object.values(this.getGroups()); },

  // Public campaign list (works logged out): used by the landing page and sign-up.
  async refreshGroups() {
    try {
      const r = await API.get('/api/groups');
      if (!r?.groups) return false;
      const groups = {};
      r.groups.forEach(g => { groups[g.id] = this.normGroup(g); });
      this._set(this.KEYS.GROUPS, groups);
      return true;
    } catch { return false; }  // offline — keep whatever is cached
  },

  // ==============================
  // DONATIONS
  // ==============================
  getDonations()             { return this._get(this.KEYS.DONATIONS); },
  getDonationsForGroup(gid)  { return this.getDonations()[gid] || {}; },

  getDonationStatus(groupId, monthKey, userId) {
    const gd = this.getDonationsForGroup(groupId);
    return gd[monthKey]?.[userId] || null;
  },

  setDonationStatus(groupId, monthKey, userId, data) {
    const all = this.getDonations();
    if (!all[groupId]) all[groupId] = {};
    if (!all[groupId][monthKey]) all[groupId][monthKey] = {};
    all[groupId][monthKey][userId] = {
      paid:        data.paid,
      amount:      data.amount || 0,
      date:        data.date || new Date().toISOString(),
      collectorId: data.collectorId || null,
    };
    this._set(this.KEYS.DONATIONS, all);
    SyncQueue.enqueue({
      method: 'PUT',
      path:   `/api/donations/${groupId}/${monthKey}/${userId}`,
      body:   { paid: !!data.paid, amount: data.amount || 0, collectorId: data.collectorId || null },
    });
  },

  getMonthlyStats(groupId, monthKey) {
    const monthData = this.getDonationsForGroup(groupId)[monthKey] || {};
    const donors = this.getDonorsByGroup(groupId);
    let totalAmount = 0, paidCount = 0, totalExpected = 0;
    const group = this.getGroup(groupId);
    const defaultPledge = group?.defaultPledge || group?.default_pledge || 5000;
    for (const donor of donors) {
      totalExpected += donor.amount || defaultPledge;
      const status = monthData[donor.id];
      if (status?.paid) { paidCount++; totalAmount += status.amount || 0; }
    }
    return {
      totalDonors: donors.length, paidCount,
      unpaidCount: donors.length - paidCount, totalAmount, totalExpected,
      completionRate: totalExpected > 0 ? Math.round((totalAmount / totalExpected) * 100) : 0,
    };
  },

  getDonorStreak(groupId, userId) {
    const gd = this.getDonationsForGroup(groupId);
    const months = Object.keys(gd).sort().reverse();
    let streak = 0;
    for (const m of months) {
      if (gd[m]?.[userId]?.paid) streak++;
      else break;
    }
    return streak;
  },

  // ==============================
  // MANAGER INTELLIGENCE
  // ==============================
  getAtRiskDonors(groupId, collectorId = null) {
    const today = new Date();
    if (today.getDate() <= 5) return [];
    const months = this.getRecentMonths(2);
    if (months.length < 2) return [];
    const [curMonth, prevMonth] = months;
    let donors = this.getDonorsByGroup(groupId);
    if (collectorId) donors = donors.filter(d => d.collectorId === collectorId);
    return donors.filter(d => {
      const paidLast = this.getDonationStatus(groupId, prevMonth, d.id)?.paid;
      const paidThis = this.getDonationStatus(groupId, curMonth, d.id)?.paid;
      return paidLast && !paidThis;
    });
  },

  // ==============================
  // ANNOUNCEMENTS
  // ==============================
  getAnnouncements()             { return this._getArray(this.KEYS.ANNOUNCEMENTS); },
  getAnnouncementsByGroup(gid)   { return this.getAnnouncements().filter(a => a.groupId === gid || a.group_id === gid); },

  addAnnouncement(announcement) {
    const all = this.getAnnouncements();
    announcement.id   = announcement.id || this.generateId();
    announcement.date = new Date().toISOString();
    all.unshift(announcement);
    this._setArray(this.KEYS.ANNOUNCEMENTS, all);
    // Server assigns its own id; reconcile swaps the temp id for the real one in cache
    // so in-session delete/edit by id works.
    SyncQueue.enqueue({
      method: 'POST', path: '/api/announcements',
      body: {
        groupId:  announcement.groupId,
        type:     announcement.type || 'general',
        title:    announcement.title || '',
        content:  announcement.content || '',
        isPinned: !!announcement.isPinned,
        image:    announcement.image || null,
      },
      reconcile: { collection: 'ANNOUNCEMENTS', tempId: announcement.id, responseField: 'announcement' },
    });
    return announcement;
  },

  deleteAnnouncement(id) {
    this._setArray(this.KEYS.ANNOUNCEMENTS, this.getAnnouncements().filter(a => a.id !== id));
    SyncQueue.enqueue({ method: 'DELETE', path: `/api/announcements/${id}` });
  },

  updateAnnouncement(id, data) {
    const all = this.getAnnouncements();
    const idx = all.findIndex(a => a.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...data }; this._setArray(this.KEYS.ANNOUNCEMENTS, all); }
    SyncQueue.enqueue({ method: 'PUT', path: `/api/announcements/${id}`, body: data });
  },

  // ==============================
  // AUDIT LOGS (local collector timing only)
  // ==============================
  logCollectorAction(groupId, monthKey, collectorId, actionType) {
    const key = `audit_${groupId}_${monthKey}`;
    const logs = this._get(key);
    if (!logs[collectorId]) logs[collectorId] = {};
    logs[collectorId][actionType] = new Date().toISOString();
    this._set(key, logs);
  },

  getLastCollectorAction(groupId, monthKey, collectorId, actionType) {
    const key = `audit_${groupId}_${monthKey}`;
    return this._get(key)[collectorId]?.[actionType] || null;
  },

  // ==============================
  // CURRENT USER / SESSION
  // ==============================
  getCurrentUser() {
    const userId = localStorage.getItem(this.KEYS.CURRENT_USER);
    return userId ? this.getUser(userId) : null;
  },

  setCurrentUser(userId) { localStorage.setItem(this.KEYS.CURRENT_USER, userId); },

  logout() {
    localStorage.removeItem(this.KEYS.CURRENT_USER);
    // Clear everything tied to the account so the next person on this device sees nothing.
    // (Groups stay: the public landing page shows them.)
    [this.KEYS.USERS, this.KEYS.DONATIONS, this.KEYS.ORPHANS, this.KEYS.ANNOUNCEMENTS,
     this.KEYS.SUPPORT_MESSAGES, this.KEYS.PAY_REPORTS, this.KEYS.CAMPAIGN_REQUESTS,
    ].forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage).filter(k => k.startsWith('audit_')).forEach(k => localStorage.removeItem(k));
  },

  // ==============================
  // SETTINGS
  // ==============================
  getSettings()             { return this._get(this.KEYS.SETTINGS); },
  saveSetting(key, value)   { const s = this.getSettings(); s[key] = value; this._set(this.KEYS.SETTINGS, s); },
  getSetting(key, def)      { const s = this.getSettings(); return s[key] !== undefined ? s[key] : def; },

  // ==============================
  // MONTH HELPERS
  // ==============================
  getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  },

  getMonthLabel(monthKey, lang = 'ar') {
    const [year, month] = monthKey.split('-');
    const names = {
      ar: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
      en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    };
    return `${(names[lang]||names.ar)[parseInt(month)-1]} ${year}`;
  },

  getRecentMonths(count = 6) {
    const months = [], now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  },

  // ═════════════════════════════
  // ORPHANS
  // ═════════════════════════════
  getOrphans() {
    try { return JSON.parse(localStorage.getItem(this.KEYS.ORPHANS)) || []; }
    catch { return []; }
  },
  getOrphansByGroup(groupId) {
    if (!groupId) return this.getOrphans();
    return this.getOrphans().filter(o => o.groupId === groupId || o.group_id === groupId);
  },
  saveOrphan(orphan) {
    if (!orphan.id) orphan.id = 'tmp_orph_' + this.generateId();
    const tbl = this.getOrphans();
    const idx = tbl.findIndex(o => o.id === orphan.id);
    if (idx >= 0) tbl[idx] = { ...tbl[idx], ...orphan }; else tbl.push(orphan);
    localStorage.setItem(this.KEYS.ORPHANS, JSON.stringify(tbl));
    const { id, ...body } = orphan;
    if (!body.birthDate) delete body.birthDate;
    SyncQueue.enqueue(idx >= 0
      ? { method: 'PUT',  path: `/api/orphans/${id}`, body }
      : { method: 'POST', path: '/api/orphans', body,
          reconcile: { collection: 'ORPHANS', tempId: id, responseField: 'orphan' } });
    return id;
  },
  deleteOrphan(id) {
    localStorage.setItem(this.KEYS.ORPHANS, JSON.stringify(this.getOrphans().filter(o => o.id !== id)));
    SyncQueue.enqueue({ method: 'DELETE', path: `/api/orphans/${id}` });
  },

  // ═════════════════════════════
  // EXPORT / IMPORT
  // ═════════════════════════════
  exportAll() {
    return {
      users:            this.getUsers(),
      groups:           this.getGroups(),
      donations:        this.getDonations(),
      announcements:    this.getAnnouncements(),
      orphans:          this.getOrphans(),
      campaignRequests: this._getArray(this.KEYS.CAMPAIGN_REQUESTS),
      supportMessages:  this._getArray(this.KEYS.SUPPORT_MESSAGES),
      payReports:       this._getArray(this.KEYS.PAY_REPORTS),
      exportDate:       new Date().toISOString(),
    };
  },

  importAll(data) {
    if (data.users)         this._set(this.KEYS.USERS, data.users);
    if (data.groups)        this._set(this.KEYS.GROUPS, data.groups);
    if (data.donations)     this._set(this.KEYS.DONATIONS, data.donations);
    if (data.announcements) this._setArray(this.KEYS.ANNOUNCEMENTS, data.announcements);
    if (data.orphans)       this._setArray(this.KEYS.ORPHANS, data.orphans);
  },

  clearAll() { Object.values(this.KEYS).forEach(k => localStorage.removeItem(k)); },

  // ==============================
  // LEADERBOARD (cache from bootstrap, async refresh)
  // ==============================
  getLeaderboard() {
    const groups = this.getAllGroupsList();
    const currentMonth = this.getCurrentMonthKey();
    return groups.map(group => {
      const stats = this.getMonthlyStats(group.id, currentMonth);
      const donors = this.getDonorsByGroup(group.id);
      const allDonations = this.getDonationsForGroup(group.id);
      let allTimeTotal = 0;
      for (const month of Object.values(allDonations)) {
        for (const d of Object.values(month)) { if (d.paid) allTimeTotal += d.amount || 0; }
      }
      return { ...group, currentMonthStats: stats, totalDonors: donors.length, allTimeTotal, score: stats.completionRate };
    }).sort((a, b) => b.score - a.score);
  },

  async refreshLeaderboard() {
    try {
      const r = await API.get('/api/leaderboard');
      return r?.leaderboard || this.getLeaderboard();
    } catch { return this.getLeaderboard(); }
  },

  // ==============================
  // CAMPAIGN REQUESTS
  // ==============================
  saveCampaignRequest(req) {
    const reqs = this._getArray(this.KEYS.CAMPAIGN_REQUESTS);
    req.id = this.generateId();
    req.createdAt = new Date().toISOString();
    reqs.push(req);
    this._setArray(this.KEYS.CAMPAIGN_REQUESTS, reqs);
    SyncQueue.enqueue({ method: 'POST', path: '/api/campaign-requests', body: { payload: req } });
    return req;
  },
  getCampaignRequests() { return this._getArray(this.KEYS.CAMPAIGN_REQUESTS); },

  // ==============================
  // SUPPORT MESSAGES
  // ==============================
  saveSupportMessage(msg) {
    const msgs = this._getArray(this.KEYS.SUPPORT_MESSAGES);
    msg.id = this.generateId();
    msg.createdAt = new Date().toISOString();
    msgs.push(msg);
    this._setArray(this.KEYS.SUPPORT_MESSAGES, msgs);
    const body = { body: msg.text || msg.body || msg.message || '', senderName: msg.senderName || undefined };
    if (msg.subject) body.subject = msg.subject;
    SyncQueue.enqueue({
      method: 'POST', path: '/api/support-messages', body,
      reconcile: { collection: 'SUPPORT_MESSAGES', tempId: msg.id, responseField: 'message' },
    });
    return msg;
  },
  getSupportMessages() { return this._getArray(this.KEYS.SUPPORT_MESSAGES); },
  deleteSupportMessage(id) {
    this._setArray(this.KEYS.SUPPORT_MESSAGES, this._getArray(this.KEYS.SUPPORT_MESSAGES).filter(m => m.id !== id));
    SyncQueue.enqueue({ method: 'DELETE', path: `/api/support-messages/${id}` });
  },

  // ==============================
  // PAY REPORTS
  // ==============================
  getPayReports(groupId) {
    const all = this._getArray(this.KEYS.PAY_REPORTS);
    return groupId ? all.filter(r => r.groupId === groupId) : all;
  },
  savePayReport(report) {
    const all = this._getArray(this.KEYS.PAY_REPORTS);
    report.id = this.generateId();
    report.createdAt = new Date().toISOString();
    report.acknowledged = false;
    all.push(report);
    this._setArray(this.KEYS.PAY_REPORTS, all);
    SyncQueue.enqueue({
      method: 'POST', path: '/api/pay-reports',
      body: {
        groupId:  report.groupId,
        donorId:  report.donorId,
        monthKey: report.monthKey || this.getCurrentMonthKey(),
        amount:   report.amount || 0,
        note:     report.note || undefined,
      },
      reconcile: { collection: 'PAY_REPORTS', tempId: report.id, responseField: 'report' },
    });
    return report;
  },
  acknowledgePayReport(reportId) {
    const all = this._getArray(this.KEYS.PAY_REPORTS);
    const idx = all.findIndex(r => r.id === reportId);
    if (idx >= 0) {
      all[idx].acknowledged = true;
      all[idx].acknowledgedAt = new Date().toISOString();
      this._setArray(this.KEYS.PAY_REPORTS, all);
      SyncQueue.enqueue({ method: 'POST', path: `/api/pay-reports/${reportId}/acknowledge` });
      return all[idx];
    }
    return null;
  },
};
