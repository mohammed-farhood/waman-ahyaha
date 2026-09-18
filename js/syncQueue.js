/* Waman Ahyaha Sync Queue — optimistic local writes flushed to server
 *
 * Every op is tagged with the user who made it and is only ever sent while that
 * same user is logged in, so one person's queued changes can never be replayed
 * under someone else's session on a shared phone.
 *
 * Outcomes per op:
 *   2xx                      → removed (and reconciled into the cache if asked)
 *   network / 429 / 5xx      → kept, retried later with backoff
 *   401                      → kept; flushing pauses until the user logs in again
 *   other 4xx                → removed, and 'waman:syncFailed' tells the UI
 */

const SyncQueue = {
  KEY: 'waman_pending_ops',
  _flushing: false,
  _retryTimer: null,
  _backoff: 0,

  _owner() {
    try { return localStorage.getItem('waman_current_user') || null; } catch { return null; }
  },

  enqueue(op) {
    op._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    op._owner = op._owner || this._owner();
    const ops = this._load();
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

  // Remove one op by id from whatever is stored NOW (ops may have been
  // enqueued while a flush was running — never overwrite the whole list).
  _remove(id) {
    this._save(this._load().filter(o => o._id !== id));
  },

  _scheduleRetry() {
    if (this._retryTimer) return;
    this._backoff = Math.min(this._backoff ? this._backoff * 2 : 5000, 5 * 60 * 1000);
    this._retryTimer = setTimeout(() => { this._retryTimer = null; this._flush(); }, this._backoff);
  },

  async _flush() {
    if (this._flushing || !navigator.onLine) return;
    const owner = this._owner();   // null for a visitor: only ownerless ops are sent
    this._flushing = true;
    let again = false;
    try {
      const sent = new Set();
      // Keep going until nothing sendable is left (picks up ops enqueued mid-flush).
      for (;;) {
        const op = this._load().find(o => !sent.has(o._id) && (!o._owner || o._owner === owner));
        if (!op) break;
        sent.add(op._id);
        try {
          const resp = await API.req(op.method, op.path, op.body);
          this._remove(op._id);
          this._backoff = 0;
          if (op.reconcile && resp && typeof DB !== 'undefined' && DB._reconcile) {
            try { DB._reconcile(op.reconcile, resp); }
            catch (e) { console.error('[SyncQueue] reconcile failed:', e, op); }
          }
        } catch (err) {
          if (err.status === 401) return;                       // wait for next login
          if (!err.status || err.status === 429 || err.status >= 500) {
            again = true;                                       // transient — retry later
            break;                                              // keep order: stop here
          }
          // Permanent client error — drop it, but loudly.
          this._remove(op._id);
          const detail = {
            method: op.method, path: op.path, status: err.status,
            error: err.message, response: err.data,
          };
          console.error('[SyncQueue] DROPPED op:', detail);
          try { window.dispatchEvent(new CustomEvent('waman:syncFailed', { detail })); } catch {}
        }
      }
    } finally {
      this._flushing = false;
      if (again) this._scheduleRetry();
    }
  },

  // Wait for the queue to drain as far as it can right now (used before logout).
  async flushNow() {
    while (this._flushing) await new Promise(r => setTimeout(r, 100));
    await this._flush();
  },

  // Drop ops belonging to anyone other than `userId` (called on login).
  dropOthers(userId) {
    const ops = this._load();
    const keep = ops.filter(o => !o._owner || o._owner === userId);
    if (keep.length !== ops.length) {
      console.warn('[SyncQueue] discarded', ops.length - keep.length, 'queued op(s) from another account');
      this._save(keep);
    }
  },

  clear() { this._save([]); },

  pendingCount() {
    return this._load().length;
  },
};

// Retry on reconnect
window.addEventListener('online', () => SyncQueue._flush());
