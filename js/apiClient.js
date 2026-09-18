/* AL-AYN API Client — cookie-based session, CSRF protection */

const API = {
  BASE: window.AL_AYN_API || '',

  csrf() {
    const m = document.cookie.match(/(?:^|; )alayn_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  },

  // Build an Error whose .message is Arabic (for UI toasts) and whose
  // .serverMessage keeps the original English (for console / debugging).
  _err(originalMessage, status, data) {
    const translated = (typeof Errors !== 'undefined' && Errors.t)
      ? Errors.t(originalMessage)
      : originalMessage;
    const err = new Error(translated);
    err.serverMessage = originalMessage;
    if (status !== undefined) err.status = status;
    if (data   !== undefined) err.data   = data;
    return err;
  },

  async req(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf() },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(this.BASE + path, opts);
    } catch (e) {
      throw this._err('network error: ' + e.message);
    }

    // Token expired — try silent refresh once.
    // Skip for auth endpoints themselves: a 401 from /login means wrong credentials
    // (not an expired session), and refresh/logout don't need pre-refresh.
    const isAuthEndpoint = path.startsWith('/api/auth/login')
      || path.startsWith('/api/auth/refresh')
      || path.startsWith('/api/auth/logout')
      || path.startsWith('/api/auth/register-donor');
    if (res.status === 401 && !isAuthEndpoint) {
      // Only attempt refresh / dispatch loggedOut if the user actually had a session.
      // Otherwise an anonymous visitor hitting a (formerly-)public endpoint that 401s
      // would trigger a spurious "session expired" toast.
      const hasSession = typeof DB !== 'undefined'
        && !!localStorage.getItem(DB.KEYS.CURRENT_USER);
      const refreshed = hasSession ? await this._tryRefresh() : false;
      if (refreshed) {
        try { res = await fetch(this.BASE + path, opts); }
        catch (e) { throw this._err('network error: ' + e.message); }
      }
      if (!res || res.status === 401) {
        if (hasSession && !this._loggedOutFired) {
          this._loggedOutFired = true;
          window.dispatchEvent(new CustomEvent('alayn:loggedOut'));
          setTimeout(() => { this._loggedOutFired = false; }, 1000);
        }
        throw this._err('unauthenticated', 401);
      }
    }

    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw this._err(data.error || `HTTP ${res.status}`, res.status, data);
    }
    return data;
  },

  _refreshing: null,

  async _tryRefresh() {
    // Coalesce concurrent refreshes — the server rotates the refresh token,
    // so a parallel second call would race on a now-deleted session row.
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      try {
        const r = await fetch(this.BASE + '/api/auth/refresh', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf() },
        });
        return r.ok;
      } catch { return false; }
      finally { this._refreshing = null; }
    })();
    return this._refreshing;
  },

  get(path)         { return this.req('GET',    path); },
  post(path, body)  { return this.req('POST',   path, body); },
  put(path, body)   { return this.req('PUT',    path, body); },
  patch(path, body) { return this.req('PATCH',  path, body); },
  del(path)         { return this.req('DELETE', path); },
};
