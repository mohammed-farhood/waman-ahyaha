// Session state: who is logged in, login / register / logout / delete-account, and (for the
// superadmin) which campaign they are currently looking at.
import { useQueryClient } from '@tanstack/react-query';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, clearTokens, del, get, getRefreshToken, loadTokens, post, saveTokens, setSessionLostHandler } from './api';
import { getItem, removeItem, setItem } from './storage';
import { User } from './types';

const K_USER = 'waman.user';
const K_GROUP = 'waman.activeGroup';

type LoginResult = { requirePin: boolean };
export type RegisterInput = {
  name: string;
  phone: string;
  groupId: string;
  collectorId?: string | null;
  amount?: number | null;
  isAnonymous?: boolean;
};

type Ctx = {
  ready: boolean;
  user: User | null;
  /** Campaign the screens show: the user's own, or the one the superadmin picked. */
  groupId: string | null;
  setGroupId: (id: string) => void;
  sessionExpired: boolean;
  login: (phone: string, pin?: string | null) => Promise<LoginResult>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (pin?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  patchUser: (u: Partial<User>) => void;
};

const AuthCtx = createContext<Ctx | null>(null);

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/**
 * Same as useAuth but for signed-in screens. Those screens are guarded (Stack.Protected), but on
 * logout they still render once more before they unmount — keep the last user so that render is safe.
 */
export function useUser() {
  const { user, ...rest } = useAuth();
  const last = useRef(user);
  if (user) last.current = user;
  return { ...rest, user: (user ?? last.current) as User };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const persistUser = useCallback((u: User | null) => {
    setUser(u);
    if (u) setItem(K_USER, JSON.stringify(u));
    else removeItem(K_USER);
  }, []);

  const localLogout = useCallback(async () => {
    await clearTokens();
    await removeItem(K_GROUP);
    persistUser(null);
    setPickedGroup(null);
    qc.clear();
  }, [persistUser, qc]);

  // Boot: restore the session instantly from storage, then confirm it with the server.
  useEffect(() => {
    let alive = true;
    (async () => {
      const has = await loadTokens();
      const [cached, g] = await Promise.all([getItem(K_USER), getItem(K_GROUP)]);
      if (g) setPickedGroup(g);
      if (has && cached) {
        try {
          setUser(JSON.parse(cached));
        } catch {
          /* corrupt cache: fall through to /me */
        }
      }
      if (has) {
        const fresh = get<{ user: User }>('/api/auth/me')
          .then((r) => alive && persistUser(r.user))
          .catch((e) => {
            // offline: keep the cached session; rejected: log out
            if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
              if (alive) setSessionExpired(true);
              return localLogout();
            }
          });
        if (!cached) await fresh;
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [localLogout, persistUser]);

  useEffect(() => {
    setSessionLostHandler(() => {
      setSessionExpired(true);
      localLogout();
    });
    return () => setSessionLostHandler(null);
  }, [localLogout]);

  const startSession = useCallback(
    async (r: { user: User; accessToken: string; refreshToken: string }) => {
      qc.clear();
      await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      setSessionExpired(false);
      persistUser(r.user);
    },
    [persistUser, qc],
  );

  const login = useCallback(
    async (phone: string, pin?: string | null): Promise<LoginResult> => {
      const r = await post<any>('/api/auth/login', { phone, pin: pin ? String(pin) : null });
      if (r.require_pin) return { requirePin: true };
      await startSession(r);
      return { requirePin: false };
    },
    [startSession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const r = await post<any>('/api/auth/register-donor', {
        name: input.name.trim(),
        phone: input.phone,
        groupId: input.groupId,
        collectorId: input.collectorId || null,
        amount: input.amount ?? null,
        isAnonymous: !!input.isAnonymous,
      });
      await startSession(r);
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    const rt = getRefreshToken();
    if (rt) await post('/api/auth/logout', { refreshToken: rt }).catch(() => {});
    await localLogout();
  }, [localLogout]);

  const deleteAccount = useCallback(
    async (pin?: string) => {
      await del('/api/auth/me', pin ? { confirm: 'DELETE', pin } : { confirm: 'DELETE' });
      await localLogout();
    },
    [localLogout],
  );

  const refreshUser = useCallback(async () => {
    const r = await get<{ user: User }>('/api/auth/me');
    persistUser(r.user);
  }, [persistUser]);

  const patchUser = useCallback(
    (p: Partial<User>) => {
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, ...p };
        setItem(K_USER, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const setGroupId = useCallback((id: string) => {
    setPickedGroup(id);
    setItem(K_GROUP, id);
  }, []);

  const groupId = user?.role === 'superadmin' ? pickedGroup : user?.group_id ?? null;

  const value = useMemo<Ctx>(
    () => ({ ready, user, groupId, setGroupId, sessionExpired, login, register, logout, deleteAccount, refreshUser, patchUser }),
    [ready, user, groupId, setGroupId, sessionExpired, login, register, logout, deleteAccount, refreshUser, patchUser],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
