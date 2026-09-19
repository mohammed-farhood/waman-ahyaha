// HTTP client for the shared backend (same server as the website).
// Mobile mode: `X-Client: mobile` → the server returns tokens in the JSON body instead of cookies,
// we send `Authorization: Bearer`, and refresh/logout carry the refresh token in the body.
import Constants from 'expo-constants';
import { GENERIC_ERROR, translateError } from './errors';
import { getItem, removeItem, setItem } from './storage';

export const API_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://waman-ahyaha.srv1956050.hstgr.cloud'
).replace(/\/+$/, '');

export const PRIVACY_URL: string =
  (Constants.expoConfig?.extra?.privacyUrl as string | undefined) || `${API_URL}/privacy.html`;

const K_ACCESS = 'waman.accessToken';
const K_REFRESH = 'waman.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  data: any;
  /** Original English server message (for logs); `message` is the Arabic one shown to users. */
  serverMessage: string;
  constructor(status: number, serverMessage: string, data?: any) {
    super(translateError(serverMessage, status));
    this.status = status;
    this.serverMessage = serverMessage;
    this.data = data;
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

export async function loadTokens() {
  [accessToken, refreshToken] = await Promise.all([getItem(K_ACCESS), getItem(K_REFRESH)]);
  return !!refreshToken;
}

export async function saveTokens(t: { accessToken?: string; refreshToken?: string }) {
  if (t.accessToken) accessToken = t.accessToken;
  if (t.refreshToken) refreshToken = t.refreshToken;
  await Promise.all([t.accessToken && setItem(K_ACCESS, t.accessToken), t.refreshToken && setItem(K_REFRESH, t.refreshToken)]);
}

export async function clearTokens() {
  accessToken = refreshToken = null;
  await Promise.all([removeItem(K_ACCESS), removeItem(K_REFRESH)]);
}

export const getRefreshToken = () => refreshToken;
export const getAccessToken = () => accessToken;
export const hasSession = () => !!refreshToken;

/** Called when the refresh token is rejected — the auth layer logs the user out. */
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

async function rawFetch(method: string, path: string, body?: unknown, withAuth = true) {
  const headers: Record<string, string> = { 'X-Client': 'mobile', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(API_URL + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      // never let a cookie in the native jar override the Bearer token (the server reads cookies first)
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, 'network error');
  } finally {
    clearTimeout(timer);
  }
}

let refreshing: Promise<boolean> | null = null;

// a 401 from these means "wrong credentials", not "token expired"
const NO_REFRESH = ['/api/auth/login', '/api/auth/register-donor', '/api/auth/refresh', '/api/auth/logout'];

/** Single-flight token refresh: parallel 401s share one refresh call. */
export function refreshSession(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await rawFetch('POST', '/api/auth/refresh', { refreshToken }, false);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            await clearTokens();
            onSessionLost?.();
          }
          return false;
        }
        const data = await res.json().catch(() => ({}));
        if (!data.accessToken) return false;
        await saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      } catch {
        return false; // offline: keep the tokens, try again later
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth !== false;
  let res = await rawFetch(method, path, body, auth);
  if (res.status === 401 && auth && refreshToken && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) res = await rawFetch(method, path, body, auth);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || data?.success === false) {
    throw new ApiError(res.status, typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`, data);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const del = <T = any>(path: string, body?: unknown) => api<T>('DELETE', path, body);

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : GENERIC_ERROR);
