/* ============================================
   WAMAN-AHYAHA DONATION TRACKER — AUTH MODULE
   All auth calls go to /api/auth/*
   ============================================ */

const Auth = {
  _me: null,

  currentUser() {
    const id = localStorage.getItem(DB.KEYS.CURRENT_USER);
    return id ? DB.getUser(id) : null;
  },

  isLoggedIn() {
    return !!this.currentUser();
  },

  // Called after login to hydrate the local cache from server
  async bootstrap() {
    try {
      const data = await API.get('/api/auth/me');
      if (data && data.user) {
        this._me = data.user;
        // Normalise server user into cache-compatible shape.
        // _noSync: this data just came FROM the server — don't echo it back via SyncQueue.
        const u = { ...DB.normUser(data.user), _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        SyncQueue.dropOthers(u.id);
        await DB.bootstrapData(u);
        SyncQueue._flush();
        return { success: true, user: u };
      }
    } catch (err) {
      if (err.status === 401) return { error: 'unauthenticated' };
    }
    return { error: 'unknown' };
  },

  async login(phone, pin = null) {
    try {
      const res = await API.post('/api/auth/login', { phone, pin });
      if (res.require_pin) return { require_pin: true };
      if (res.success) {
        // _noSync: this user came straight from /login response — no need to PUT it back.
        const u = { ...DB.normUser(res.user), _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        SyncQueue.dropOthers(u.id);
        await DB.bootstrapData(u);
        SyncQueue._flush();
        return { success: true, user: u };
      }
      return { error: res.error || 'login failed' };
    } catch (err) {
      return { error: err.message || 'login failed' };
    }
  },

  async registerDonor(data) {
    try {
      // Only include collectorId if one was picked. Sending `null` for an "optional"
      // Zod field is rejected because `.optional()` accepts undefined, not null.
      const body = {
        name:        data.name,
        phone:       data.phone,
        groupId:     data.groupId,
        amount:      data.amount || 0,
        isAnonymous: !!data.isAnonymous,
      };
      if (data.collectorId) body.collectorId = data.collectorId;
      const res = await API.post('/api/auth/register-donor', body);
      if (res.success) {
        // The server sets the session cookies on registration; hydrate like a login.
        const u = { ...DB.normUser(res.user), _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        SyncQueue.dropOthers(u.id);
        await DB.bootstrapData(u);
        return u;
      }
      throw new Error(res.error || 'registration failed');
    } catch (err) {
      throw err;
    }
  },

  // Collector/admin adds a donor to their campaign. If the phone already belongs
  // to a donor of the same campaign, the server links that donor instead.
  async addDonor(data) {
    const body = {
      name:        data.name,
      phone:       data.phone,
      amount:      data.amount || 0,
      isAnonymous: !!data.isAnonymous,
    };
    if (data.groupId)     body.groupId     = data.groupId;
    if (data.collectorId) body.collectorId = data.collectorId;
    const res = await API.post('/api/users/donors', body);
    const u = { ...DB.normUser(res.user), _noSync: true };
    DB.saveUser(u);
    return { user: u, linked: !!res.linked };
  },

  async registerCollector(data) {
    try {
      const res = await API.post('/api/auth/register-collector', {
        name:        data.name,
        phone:       data.phone,
        pin:         data.pin,
        groupId:     data.groupId,
        stage:       data.stage,
        availability: data.availability,
      });
      if (res.success) {
        // _noSync: we just got this row from the server — don't echo it back.
        const u = { ...DB.normUser(res.user), _noSync: true };
        DB.saveUser(u);
        return u;
      }
      throw new Error(res.error || 'registration failed');
    } catch (err) {
      throw err;
    }
  },

  async logout() {
    // Send anything still queued while the session is valid, then drop the rest:
    // the next person on this device must never replay this user's changes.
    try { await Promise.race([SyncQueue.flushNow(), new Promise(r => setTimeout(r, 5000))]); } catch {}
    try { await API.post('/api/auth/logout'); } catch {}
    SyncQueue.clear();
    DB.logout();
    this._me = null;
  },

  isSuperAdmin() {
    const user = this.currentUser();
    return user && user.role === 'superadmin';
  },

  isAdmin() {
    const user = this.currentUser();
    return user && (user.role === 'admin' || user.role === 'superadmin');
  },

  isCollector() {
    const user = this.currentUser();
    return user && user.role === 'collector';
  },

  isDonor() {
    const user = this.currentUser();
    return user && user.role === 'donor';
  },

  canManageDonations() {
    return this.isSuperAdmin() || this.isAdmin() || this.isCollector();
  },

  canPostAnnouncements() {
    return this.isSuperAdmin() || this.isAdmin() || this.isCollector();
  },
};
