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
        const u = { ...data.user, groupId: data.user.group_id, collectorId: data.user.collector_id, _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        await DB.bootstrapData(u);
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
        const u = { ...res.user, groupId: res.user.group_id, collectorId: res.user.collector_id, _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        await DB.bootstrapData(u);
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
        // _noSync: we just got this row from the server — don't echo it back.
        const u = { ...res.user, groupId: res.user.group_id, _noSync: true };
        DB.saveUser(u);
        DB.setCurrentUser(u.id);
        return u;
      }
      throw new Error(res.error || 'registration failed');
    } catch (err) {
      throw err;
    }
  },

  async registerCollector(data) {
    try {
      const res = await API.post('/api/auth/register-collector', {
        name:        data.name,
        phone:       data.phone,
        pin:         data.pin || '0000',
        groupId:     data.groupId,
        stage:       data.stage,
        availability: data.availability,
      });
      if (res.success) {
        // _noSync: we just got this row from the server — don't echo it back.
        const u = { ...res.user, groupId: res.user.group_id, _noSync: true };
        DB.saveUser(u);
        return u;
      }
      throw new Error(res.error || 'registration failed');
    } catch (err) {
      throw err;
    }
  },

  async createGroup(groupData, adminData) {
    try {
      const gRes = await API.post('/api/groups', {
        name:             groupData.name,
        university:       groupData.university,
        icon:             groupData.icon,
        orphansSponsored: groupData.orphansSponsored || 1,
        costPerOrphan:    groupData.costPerOrphan || 25000,
        defaultPledge:    groupData.defaultPledge || 5000,
      });
      if (!gRes.success) throw new Error(gRes.error || 'group creation failed');
      const group = gRes.group;

      const aRes = await API.post('/api/auth/register-collector', {
        name:    adminData.name,
        phone:   adminData.phone,
        pin:     adminData.pin || '0000',
        groupId: group.id,
        role:    'admin',
      });
      if (!aRes.success) throw new Error(aRes.error || 'admin creation failed');
      const admin = { ...aRes.user, groupId: group.id };

      // _noSync on both: server already created the rows; we're just hydrating cache.
      DB.saveGroup({ ...group, orphansSponsored: group.orphans_sponsored, costPerOrphan: group.cost_per_orphan, monthlyGoal: group.monthly_goal, _noSync: true });
      DB.saveUser({ ...admin, _noSync: true });
      DB.setCurrentUser(admin.id);
      return { group, admin };
    } catch (err) {
      throw err;
    }
  },

  async logout() {
    try { await API.post('/api/auth/logout'); } catch {}
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
