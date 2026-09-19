import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Avatar, StatTile } from '@/components/brand';
import { PageHeader } from '@/components/page-header';
import { PayHowSheet, ReminderSheet } from '@/components/sheets';
import { Badge, Button, Card, Empty, Icon, LoadingCards, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useUser } from '@/lib/auth';
import { fmt, money, monthKey, monthLabel, timeAgo } from '@/lib/format';
import {
  atRiskDonors,
  donorStreak,
  isPaid,
  monthlyStats,
  pledge,
  useAnnouncements,
  useCampaign,
  useOrphans,
  usePayReports,
} from '@/lib/queries';
import { ROLE_LABEL, User, isManager, isStaff } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

export default function Home() {
  const c = useColors();
  const { user } = useUser();
  const camp = useCampaign();
  const { group, groupId, donors, collectors, dmap } = camp;
  const orphans = useOrphans(groupId);
  const news = useAnnouncements(groupId);
  const reports = usePayReports(groupId, isStaff(user.role));
  const [payFor, setPayFor] = useState<User | null>(null);
  const [remind, setRemind] = useState(false);

  const month = monthKey();
  const stats = useMemo(() => monthlyStats(donors, dmap, month, group), [donors, dmap, month, group]);
  const myDonors = useMemo(() => (user.role === 'collector' ? donors.filter((d) => d.collector_id === user.id) : donors), [donors, user]);
  const risky = useMemo(() => atRiskDonors(myDonors, dmap), [myDonors, dmap]);
  const unpaidMine = useMemo(() => myDonors.filter((d) => !isPaid(dmap, month, d.id)), [myDonors, dmap, month]);
  const pendingReports = (reports.data ?? []).filter((r) => !r.acknowledged).length;
  const latest = (news.data ?? []).filter((a) => a.type !== 'reminder').slice(0, 2);

  const refreshing = camp.refreshing || news.isRefetching;
  const onRefresh = () => {
    camp.refetch();
    news.refetch();
    orphans.refetch();
    if (isStaff(user.role)) reports.refetch();
  };

  const firstName = user.name.split(' ')[0];

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title={`أهلاً، ${firstName}`} subtitle={[ROLE_LABEL[user.role], group?.name].filter(Boolean).join(' · ')} />

      {camp.loading ? (
        <LoadingCards count={3} />
      ) : !groupId ? (
        <Empty icon="flag" title="لا توجد حملات بعد" body="أنشئ حملة من موقع المنصة" />
      ) : (
        <>
          {user.role === 'donor' && <DonorStatus user={user} dmap={dmap} month={month} onPayHow={() => setPayFor(user)} botUsername={group?.bot_username ?? null} />}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <StatTile value={`${fmt(stats.paidCount)}/${fmt(stats.totalDonors)}`} label="سدّدوا هذا الشهر" tone="success" />
            <StatTile value={fmt(stats.totalAmount)} label="د.ع جُمعت هذا الشهر" tone="gold" />
            <Card onPress={() => router.push('/orphans')} style={{ flex: 1, minWidth: '45%', padding: space.md, gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="number" color={c.primary}>
                  {fmt(orphans.data?.length ?? 0)}
                </T>
                <Icon name="chevron-left" size={18} color={c.subtle} />
              </Row>
              <T v="caption" color={c.muted}>
                يتيم مكفول
              </T>
            </Card>
            <StatTile value={`${fmt(stats.completionRate)}%`} label="نسبة الإنجاز" />
          </View>

          <Card style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="heading">تقدّم {monthLabel(month)}</T>
              <Badge label={`${fmt(stats.completionRate)}%`} tone={stats.completionRate >= 100 ? 'success' : 'primary'} />
            </Row>
            <ProgressBar value={stats.completionRate / 100} height={10} color={stats.completionRate >= 100 ? c.success : c.primary} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Mini label="الهدف (التعهدات)" value={money(stats.totalExpected)} />
              <Mini label="المُحصّل" value={money(stats.totalAmount)} />
              <Mini label="المتبقي" value={money(Math.max(0, stats.totalExpected - stats.totalAmount))} />
            </Row>
          </Card>

          {user.role === 'collector' && (
            <Card style={{ gap: space.md }}>
              <T v="heading">متبرعيّ — {monthLabel(month)}</T>
              <Row style={{ justifyContent: 'space-between' }}>
                <T color={c.muted}>
                  سدّد {fmt(myDonors.length - unpaidMine.length)} من {fmt(myDonors.length)}
                </T>
                <T v="label" color={c.primary}>
                  {myDonors.length ? Math.round(((myDonors.length - unpaidMine.length) / myDonors.length) * 100) : 0}%
                </T>
              </Row>
              <ProgressBar value={myDonors.length ? (myDonors.length - unpaidMine.length) / myDonors.length : 0} />
              <Row gap={space.sm}>
                <Button small title="إدارة التبرعات" icon="grid" style={{ flex: 1 }} onPress={() => router.navigate('/grid')} />
                <Button small kind="soft" title="إرسال تذكير" icon="bell" style={{ flex: 1 }} onPress={() => setRemind(true)} />
              </Row>
            </Card>
          )}

          {isManager(user.role) && collectors.length > 0 && (
            <Card style={{ gap: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T v="heading">أداء جامعي التبرعات</T>
                <Button small kind="ghost" title="تذكير" icon="bell" onPress={() => setRemind(true)} />
              </Row>
              {collectors.map((col) => {
                const mine = donors.filter((d) => d.collector_id === col.id);
                const paid = mine.filter((d) => isPaid(dmap, month, d.id)).length;
                return (
                  <View key={col.id} style={{ gap: 6 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <T v="label">{col.name}</T>
                      <T v="caption" color={c.muted}>
                        {fmt(paid)}/{fmt(mine.length)}
                      </T>
                    </Row>
                    <ProgressBar value={mine.length ? paid / mine.length : 0} height={6} />
                  </View>
                );
              })}
            </Card>
          )}

          {isStaff(user.role) && pendingReports > 0 && (
            <Card onPress={() => router.navigate('/collectors')} style={{ borderColor: c.info, borderWidth: 1 }}>
              <Row gap={space.md}>
                <Icon name="inbox" color={c.info} />
                <T style={{ flex: 1 }}>{fmt(pendingReports)} بلاغ استلام بانتظار التأكيد</T>
                <Icon name="chevron-left" color={c.muted} />
              </Row>
            </Card>
          )}

          {isStaff(user.role) && risky.length > 0 && (
            <Card style={{ gap: space.sm, borderColor: c.warning, borderWidth: 1 }}>
              <Row gap={space.sm}>
                <Icon name="alert-triangle" color={c.warning} />
                <T v="heading" style={{ flex: 1 }}>
                  متبرعون قد يحتاجون تذكيراً ({fmt(risky.length)})
                </T>
              </Row>
              <T v="caption" color={c.muted}>
                سدّدوا الشهر الماضي ولم يسدّدوا هذا الشهر بعد
              </T>
              {risky.slice(0, 5).map((d) => (
                <Row key={d.id}>
                  <T style={{ flex: 1 }}>{d.name}</T>
                  <T v="caption" color={c.muted}>
                    {money(pledge(d))}
                  </T>
                </Row>
              ))}
              <Button small kind="soft" title="إرسال تذكير" icon="bell" onPress={() => setRemind(true)} />
            </Card>
          )}

          <Card onPress={() => router.push('/leaderboard')}>
            <Row gap={space.md}>
              <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: c.goldBg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="award" color={c.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="heading">ترتيب الحملات</T>
                <T v="caption" color={c.muted}>
                  منافسة إيجابية بين المجموعات هذا الشهر
                </T>
              </View>
              <Icon name="chevron-left" color={c.muted} />
            </Row>
          </Card>

          <SectionTitle title="آخر الأخبار" action={latest.length ? <Button small kind="ghost" title="الكل" onPress={() => router.navigate('/news')} /> : undefined} />
          {latest.length === 0 ? (
            <Card>
              <T color={c.muted} center>
                لا توجد أخبار بعد
              </T>
            </Card>
          ) : (
            latest.map((a) => (
              <Card key={a.id} onPress={() => router.navigate('/news')} style={{ gap: 4 }}>
                <Row gap={space.sm}>
                  <Avatar name={a.author_name} size={28} />
                  <T v="label" style={{ flex: 1 }}>
                    {a.author_name || 'إدارة الحملة'}
                  </T>
                  <T v="caption" color={c.muted}>
                    {timeAgo(a.posted_at)}
                  </T>
                </Row>
                {a.title ? <T v="heading">{a.title}</T> : null}
                {a.content ? (
                  <T numberOfLines={2} color={c.text}>
                    {a.content}
                  </T>
                ) : null}
              </Card>
            ))
          )}
        </>
      )}

      <PayHowSheet donor={payFor} collector={collectors.find((x) => x.id === payFor?.collector_id) ?? null} month={month} onClose={() => setPayFor(null)} />
      <ReminderSheet visible={remind} onClose={() => setRemind(false)} group={group} unpaid={unpaidMine} />
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T v="label">{value}</T>
      <T v="caption" color={c.muted}>
        {label}
      </T>
    </View>
  );
}

function DonorStatus({ user, dmap, month, onPayHow, botUsername }: { user: User; dmap: ReturnType<typeof useCampaign>['dmap']; month: string; onPayHow: () => void; botUsername: string | null }) {
  const c = useColors();
  const row = dmap[month]?.[user.id];
  const paid = !!row?.paid;
  const streak = donorStreak(user.id, dmap);
  return (
    <>
      <Card style={{ gap: space.md, backgroundColor: paid ? c.successBg : c.surface, borderColor: paid ? c.success : c.border }}>
        <Row>
          <T v="heading" style={{ flex: 1 }}>
            تبرعي — {monthLabel(month)}
          </T>
          {streak > 1 && <Badge label={`${fmt(streak)} شهر متواصل`} tone="gold" icon="zap" />}
        </Row>
        <Row gap={space.md}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paid ? c.success : c.warningBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={paid ? 'check' : 'clock'} size={24} color={paid ? '#FFFFFF' : c.warning} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="title" color={paid ? c.success : c.heading}>
              {paid ? 'تم السداد، جزاك الله خيراً' : 'لم يُسجَّل السداد بعد'}
            </T>
            <T color={c.muted}>{paid ? money(row?.amount) : `المبلغ المطلوب: ${money(pledge(user))}`}</T>
          </View>
        </Row>
        {!paid && <Button small kind="soft" icon="help-circle" title="كيف أسدّد تبرعي؟" onPress={onPayHow} />}
      </Card>
      {botUsername && !user.telegram_chat_id && (
        <Card onPress={() => router.push('/telegram')} style={{ borderColor: c.info, borderWidth: 1 }}>
          <Row gap={space.md}>
            <Icon name="send" color={c.info} />
            <View style={{ flex: 1 }}>
              <T v="heading">اربط حسابك بالتليجرام</T>
              <T v="caption" color={c.muted}>
                لتصلك إيصالات الدفع والتذكيرات مباشرة
              </T>
            </View>
            <Icon name="chevron-left" color={c.muted} />
          </Row>
        </Card>
      )}
    </>
  );
}
