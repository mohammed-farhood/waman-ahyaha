// Shapes returned by the backend (snake_case, exactly as the server sends them).
export type Role = 'superadmin' | 'admin' | 'collector' | 'donor';

export interface Availability {
  days?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
}

export interface User {
  id: string;
  name: string;
  phone: string | null;
  role: Role;
  group_id: string | null;
  collector_id: string | null;
  amount: number | null;
  is_anonymous: boolean | null;
  join_date: string;
  stage: string | null;
  availability: Availability | null;
  telegram_chat_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Group {
  id: string;
  name: string;
  university: string | null;
  icon: string | null;
  orphans_sponsored: number;
  cost_per_orphan: number;
  monthly_goal: number;
  default_pledge: number;
  created_at: string;
  donor_count: number;
  collectors: { id: string; name: string }[];
  bot_username: string | null;
}

export interface Donation {
  group_id: string;
  month_key: string;
  user_id: string;
  paid: boolean;
  amount: number;
  paid_date: string | null;
  collector_id: string | null;
  updated_at: string;
}

export interface Announcement {
  id: string;
  group_id: string;
  author_id: string | null;
  author_name: string | null;
  type: string;
  title: string;
  content: string;
  posted_at: string;
  is_pinned: boolean;
  image: string | null;
}

export interface Orphan {
  id: string;
  group_id: string;
  name: string;
  code: string | null;
  province: string | null;
  type: string | null;
  amount: number | null;
  status: string | null;
  birth_date: string | null;
  notes: string | null;
}

export interface PayReport {
  id: string;
  group_id: string;
  reporter_id: string | null;
  donor_id: string | null;
  month_key: string;
  amount: number | null;
  note: string | null;
  acknowledged: boolean | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  university: string | null;
  icon: string | null;
  orphans_sponsored: number;
  cost_per_orphan: number;
  monthly_goal: number;
  total_donors: number;
  month_paid: number;
  all_time_total: number;
  completion_rate: number;
}

export interface SupportMessage {
  id: string;
  from_user: string;
  phone: string | null;
  subject: string | null;
  body: string;
  created_at: string;
  resolved: boolean | null;
  from_user_id: string | null;
  group_id: string | null;
}

export interface CampaignRequest {
  id: string;
  payload: { name: string; phone: string; message?: string };
  created_at: string;
  resolved: boolean | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'المدير العام',
  admin: 'مسؤول الحملة',
  collector: 'جامع التبرعات',
  donor: 'متبرع',
};

export const isStaff = (r?: Role | null) => r === 'collector' || r === 'admin' || r === 'superadmin';
export const isManager = (r?: Role | null) => r === 'admin' || r === 'superadmin';
