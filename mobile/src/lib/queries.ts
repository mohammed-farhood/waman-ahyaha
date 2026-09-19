// Data layer: React Query hooks for every server resource, plus the derived numbers
// (monthly stats, streaks, at-risk donors) computed exactly like the website (js/data.js).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { del, get, patch, post, put } from './api';
import { useAuth } from './auth';
import { baghdadDayOfMonth, monthKey, recentMonths } from './format';
import {
  Announcement,
  Availability,
  CampaignRequest,
  Donation,
  Group,
  LeaderboardRow,
  Orphan,
  PayReport,
  SupportMessage,
  User,
  isManager,
  isStaff,
} from './types';

export const DEFAULT_PLEDGE = 5000;
export const pledge = (u: Pick<User, 'amount'> | null | undefined) => (u?.amount ? u.amount : DEFAULT_PLEDGE);
export const GRID_MONTHS = 6;

const q = (params: Record<string, string | null | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return s ? `?${s}` : '';
};

// ── Reads ──────────────────────────────────────────────────────────────

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => get<{ groups: Group[] }>('/api/groups').then((r) => r.groups),
    staleTime: 60_000,
  });
}

/** The campaign every screen shows. Superadmin without a pick → first campaign. */
export function useActiveGroup() {
  const { groupId, user } = useAuth();
  const groups = useGroups();
  const id = groupId ?? (user?.role === 'superadmin' ? groups.data?.[0]?.id ?? null : null);
  const group = groups.data?.find((g) => g.id === id) ?? null;
  return { id, group, groups: groups.data ?? [], loading: groups.isLoading };
}

export function useUsers(groupId: string | null) {
  return useQuery({
    queryKey: ['users', groupId],
    enabled: !!groupId,
    queryFn: () => get<{ users: User[] }>(`/api/users${q({ groupId })}`).then((r) => r.users),
  });
}

const donationsFrom = () => recentMonths(GRID_MONTHS)[GRID_MONTHS - 1];

export function useDonations(groupId: string | null) {
  return useQuery({
    queryKey: ['donations', groupId],
    enabled: !!groupId,
    queryFn: () => get<{ donations: Donation[] }>(`/api/donations${q({ from: donationsFrom(), groupId })}`).then((r) => r.donations),
  });
}

export function useAnnouncements(groupId: string | null) {
  return useQuery({
    queryKey: ['announcements', groupId],
    enabled: !!groupId,
    queryFn: () => get<{ announcements: Announcement[] }>(`/api/announcements${q({ groupId })}`).then((r) => r.announcements),
  });
}

export function useOrphans(groupId: string | null) {
  return useQuery({
    queryKey: ['orphans', groupId],
    enabled: !!groupId,
    queryFn: () => get<{ orphans: Orphan[] }>(`/api/orphans${q({ groupId })}`).then((r) => r.orphans),
  });
}

export function usePayReports(groupId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['payReports', groupId],
    enabled: !!groupId && enabled,
    queryFn: () => get<{ reports: PayReport[] }>(`/api/pay-reports${q({ groupId })}`).then((r) => r.reports),
  });
}

export function useLeaderboard(month = monthKey()) {
  return useQuery({
    queryKey: ['leaderboard', month],
    queryFn: () => get<{ leaderboard: LeaderboardRow[] }>(`/api/leaderboard${q({ month })}`).then((r) => r.leaderboard),
  });
}

export function useSupportMessages(enabled: boolean) {
  return useQuery({
    queryKey: ['support'],
    enabled,
    queryFn: () => get<{ messages: SupportMessage[] }>('/api/support-messages').then((r) => r.messages),
  });
}

export function useCampaignRequests(enabled: boolean) {
  return useQuery({
    queryKey: ['campaignRequests'],
    enabled,
    queryFn: () => get<{ requests: CampaignRequest[] }>('/api/campaign-requests').then((r) => r.requests),
  });
}

export function useGroupTelegram(groupId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['groupTelegram', groupId],
    enabled: !!groupId && enabled,
    queryFn: () => get<{ ownBot: string | null; defaultBot: string | null }>(`/api/groups/${groupId}/telegram`),
  });
}

export function useDefaultBot(enabled: boolean) {
  return useQuery({
    queryKey: ['defaultBot'],
    enabled,
    queryFn: () => get<{ connected: boolean; username: string; source: 'app' | 'env' | null }>('/api/telegram/default-bot'),
  });
}

// ── Derived data (mirrors js/data.js) ──────────────────────────────────

export type DonationMap = Record<string, Record<string, Donation>>; // month → userId → row

export function useCampaign() {
  const { user } = useAuth();
  const { id, group, groups } = useActiveGroup();
  const users = useUsers(id);
  const donations = useDonations(id);
  const all = users.data ?? [];
  const donors = useMemo(() => all.filter((u) => u.role === 'donor'), [all]);
  const collectors = useMemo(() => all.filter((u) => u.role === 'collector'), [all]);
  const dmap = useMemo(() => {
    const m: DonationMap = {};
    for (const d of donations.data ?? []) (m[d.month_key] ??= {})[d.user_id] = d;
    return m;
  }, [donations.data]);
  return {
    user,
    groupId: id,
    group,
    groups,
    users: all,
    donors,
    collectors,
    dmap,
    loading: users.isLoading || donations.isLoading,
    error: users.error || donations.error,
    refetch: () => Promise.all([users.refetch(), donations.refetch()]),
    refreshing: users.isRefetching || donations.isRefetching,
  };
}

export const isPaid = (dmap: DonationMap, month: string, userId: string) => !!dmap[month]?.[userId]?.paid;

export function monthlyStats(donors: User[], dmap: DonationMap, month: string, group?: Group | null) {
  const fallback = group?.default_pledge || DEFAULT_PLEDGE;
  let paidCount = 0;
  let totalAmount = 0;
  let totalExpected = 0;
  for (const d of donors) {
    totalExpected += d.amount || fallback;
    const row = dmap[month]?.[d.id];
    if (row?.paid) {
      paidCount++;
      totalAmount += row.amount || 0;
    }
  }
  return {
    totalDonors: donors.length,
    paidCount,
    unpaidCount: donors.length - paidCount,
    totalAmount,
    totalExpected,
    completionRate: totalExpected > 0 ? Math.round((totalAmount / totalExpected) * 100) : 0,
  };
}

/** Consecutive paid months, newest first, over months where the campaign has any record (website rule). */
export function donorStreak(userId: string, dmap: DonationMap) {
  const months = Object.keys(dmap).sort().reverse();
  let n = 0;
  for (const m of months) {
    if (dmap[m]?.[userId]?.paid) n++;
    else break;
  }
  return n;
}

/** Paid last month but not this month — only after the 5th (Baghdad), like the server. */
export function atRiskDonors(donors: User[], dmap: DonationMap) {
  if (baghdadDayOfMonth() <= 5) return [];
  const cur = monthKey();
  const prev = monthKey(-1);
  return donors.filter((d) => isPaid(dmap, prev, d.id) && !isPaid(dmap, cur, d.id));
}

/** Donors a staff member manages in the grid: collectors see only their own list. */
export function visibleDonors(user: User, donors: User[]) {
  return user.role === 'collector' ? donors.filter((d) => d.collector_id === user.id) : donors;
}

export const canEditGrid = (user: User) => isStaff(user.role);

// ── Writes ─────────────────────────────────────────────────────────────

type DonationBody = { paid: boolean; amount: number; collectorId: string | null };

/** Mark one grid cell; optimistic so the tick appears instantly, rolled back if the server refuses. */
export function useSetDonation(groupId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { month: string; userId: string } & DonationBody) =>
      put<{ donation: Donation }>(`/api/donations/${groupId}/${v.month}/${v.userId}`, {
        paid: v.paid,
        amount: v.amount,
        collectorId: v.collectorId,
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['donations', groupId] });
      const prev = qc.getQueryData<Donation[]>(['donations', groupId]);
      qc.setQueryData<Donation[]>(['donations', groupId], (rows = []) => {
        const rest = rows.filter((r) => !(r.month_key === v.month && r.user_id === v.userId));
        return [
          ...rest,
          {
            group_id: groupId as string,
            month_key: v.month,
            user_id: v.userId,
            paid: v.paid,
            amount: v.amount,
            collector_id: v.collectorId,
            paid_date: v.paid ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
        ];
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['donations', groupId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['donations', groupId] }),
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export const sendReceipt = (b: { chatId: string; amount: number; month: string; donorName?: string; collectorName?: string }) =>
  post('/api/send-receipt', b);

export const sendReminders = (messages: { chatId: string; text: string }[]) =>
  post<{ count: number }>('/api/send-reminders', { messages });

export const addDonor = (b: { name: string; phone: string; groupId?: string; collectorId?: string | null; amount?: number; isAnonymous?: boolean }) =>
  post<{ linked: boolean; user: User }>('/api/users/donors', b);

export const updateUser = (id: string, b: { name?: string; availability?: Availability; stage?: string | null; isAnonymous?: boolean; amount?: number | null; collectorId?: string | null }) =>
  put<{ user: User }>(`/api/users/${id}`, b);

export const registerCollector = (b: { name: string; phone: string; pin: string; groupId: string; stage?: string }) =>
  post<{ user: User }>('/api/auth/register-collector', b);

export const createPayReport = (b: { groupId: string; donorId: string; monthKey: string; amount: number; note?: string }) =>
  post<{ report: PayReport }>('/api/pay-reports', b);

export const acknowledgePayReport = (id: string) => post<{ report: PayReport }>(`/api/pay-reports/${id}/acknowledge`, {});

export const createAnnouncement = (b: { groupId: string; type: string; title?: string; content?: string; isPinned?: boolean; image?: string | null }) =>
  post<{ announcement: Announcement }>('/api/announcements', b);

export const updateAnnouncement = (id: string, b: { title?: string; content?: string; isPinned?: boolean }) =>
  put<{ announcement: Announcement }>(`/api/announcements/${id}`, b);

export const deleteAnnouncement = (id: string) => del(`/api/announcements/${id}`);

export type OrphanInput = { name: string; code?: string; province?: string; type?: string; amount?: number; birthDate?: string };
/** The server rejects null for optional orphan fields — drop empty ones instead. */
const compact = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined)) as Partial<T>;
export const createOrphan = (groupId: string, b: OrphanInput) => post<{ orphan: Orphan }>('/api/orphans', { groupId, ...compact(b) });
export const updateOrphan = (id: string, b: OrphanInput) => put<{ orphan: Orphan }>(`/api/orphans/${id}`, compact(b));
export const deleteOrphan = (id: string) => del(`/api/orphans/${id}`);

export const sendSupportMessage = (b: { text: string; name?: string }) =>
  post('/api/support-messages', { body: b.text, ...(b.name ? { senderName: b.name.slice(0, 100) } : {}) });

export const sendCampaignRequest = (b: { name: string; phone: string; message?: string }) =>
  post('/api/campaign-requests', { payload: { name: b.name.trim(), phone: b.phone.trim(), ...(b.message?.trim() ? { message: b.message.trim() } : {}) } });

export const deleteSupportMessage = (id: string) => del(`/api/support-messages/${id}`);
export const resolveSupportMessage = (id: string) => patch(`/api/support-messages/${id}/resolve`);
export const resolveCampaignRequest = (id: string) => patch(`/api/campaign-requests/${id}/resolve`);

export const setCampaignBot = (groupId: string, botToken: string) => post<{ username: string }>(`/api/groups/${groupId}/bot-token`, { botToken });
export const removeCampaignBot = (groupId: string) => del(`/api/groups/${groupId}/bot-token`);
export const setDefaultBot = (botToken: string) => post<{ username: string }>('/api/telegram/default-bot', { botToken });
export const removeDefaultBot = () => del('/api/telegram/default-bot');

// Telegram account link (donor): code → open bot → poll → attach chat id to the account.
export const requestTelegramCode = () => post<{ code: string; botUsername: string }>('/api/auth-code', {});
export const checkTelegramCode = (code: string) => get<{ status: 'pending' | 'linked'; chatId: string | null }>(`/api/check-auth/${code}`);
export const attachTelegram = (userId: string, code: string) => post<{ chatId: string }>(`/api/users/${userId}/telegram-link`, { code });
export const detachTelegram = (userId: string) => post(`/api/users/${userId}/telegram-unlink`, {});

export { isManager, isStaff };
