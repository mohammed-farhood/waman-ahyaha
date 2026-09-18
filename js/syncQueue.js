/* AL-AYN Sync Queue — optimistic local writes flushed to server */

const SyncQueue = {
  KEY: 'alayn_pending_ops',
  _flushing: false,

  enqueue(op) {
    const ops = this._load();
    op._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ops.push(op);
    this._save(ops);
    this._flush();
  },

  _load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
    catch { return []; }
  },

  _save(ops) {
    localStorage.setItem(this.KEY, JSON.stringify(ops));
  },

  async _flush() {
    if (this._flushing || !navigator.onLine) return;
    this._flushing = true;
    try {
      const ops = this._load();
      if (!ops.length) return;

      const remaining = [];
      for (const op of ops) {
        try {
          const resp = await API.req(op.method, op.path, op.body);
          // Reconcile server-assigned ids back into local cache, if requested.
          if (op.reconcile && resp && typeof DB !== 'undefined' && DB._reconcile) {
            try { DB._reconcile(op.reconcile, resp); }
            catch (e) { console.error('[SyncQueue] reconcile failed:', e, op); }
          }
        } catch (err) {
          if (err.status === 401) {
            // Auth gone — stop and clear queue
            this._save([]);
            return;
          }
          if (err.status >= 400 && err.status < 500) {
            // Client error — drop this op (bad data, already applied, etc.).
            // LOUD: silently swallowing 4xx is exactly how create-campaign failed unnoticed.
            const detail = {
              method: op.method, path: op.path, status: err.status,
              error: err.message, response: err.data, body: op.body,
            };
            console.error('[SyncQueue] DROPPED 4xx op:', detail);
            try { window.dispatchEvent(new CustomEvent('alayn:syncFailed', { detail })); } catch {}
            continue;
          }
          // Server error or network error — keep for retry
          remaining.push(op);
        }
      }
      this._save(remaining);
    } finally {
      this._flushing = false;
    }
  },

  pendingCount() {
    return this._load().length;
  },
};

// Retry on reconnect
window.addEventListener('online', () => SyncQueue._flush());
