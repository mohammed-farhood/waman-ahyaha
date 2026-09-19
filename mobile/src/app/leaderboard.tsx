// Campaign ranking from the server (/api/leaderboard): this month's collection against each
// campaign's orphan-sponsorship goal, plus all-time totals.
import { View } from 'react-native';

import { Badge, Card, Empty, LoadingCards, ProgressBar, Row, Screen, SectionTitle, T } from '@/components/ui';
import { useActiveGroup, useLeaderboard } from '@/lib/queries';
import { fmt, money, monthKey, monthLabel } from '@/lib/format';
import { radius, space, useColors } from '@/theme';

export default function Leaderboard() {
  const c = useColors();
  const q = useLeaderboard();
  const { id: mine } = useActiveGroup();
  const rows = q.data ?? [];
  const topAllTime = Math.max(1, ...rows.map((r) => r.all_time_total));
  const medal = [c.gold, '#94A3B8', '#B7791F'];

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={q.refetch}>
      <T color={c.muted}>ترتيب الحملات حسب نسبة ما جُمع في {monthLabel(monthKey())} من هدف كفالة أيتامها.</T>
      {q.isLoading ? (
        <LoadingCards count={3} />
      ) : rows.length === 0 ? (
        <Empty icon="award" title="لا توجد حملات بعد" />
      ) : (
        <>
          {rows.map((r, i) => (
            <Card key={r.id} style={{ gap: space.sm, borderColor: r.id === mine ? c.primary : c.border, borderWidth: r.id === mine ? 1.5 : undefined }}>
              <Row gap={space.md}>
                <View style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: i < 3 ? medal[i] : c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <T v="label" color={i < 3 ? '#FFFFFF' : c.muted}>
                    {fmt(i + 1)}
                  </T>
                </View>
                <View style={{ flex: 1 }}>
                  <Row gap={6}>
                    <T v="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {r.name}
                    </T>
                    {r.id === mine && <Badge label="حملتك" />}
                  </Row>
                  <T v="caption" color={c.muted}>
                    {[r.university, `${fmt(r.total_donors)} متبرع`, `${fmt(r.orphans_sponsored)} يتيم`].filter(Boolean).join(' · ')}
                  </T>
                </View>
                <T v="heading" color={r.completion_rate >= 100 ? c.success : c.primary}>
                  {fmt(r.completion_rate)}%
                </T>
              </Row>
              <ProgressBar value={r.completion_rate / 100} color={r.completion_rate >= 100 ? c.success : c.primary} />
              <T v="caption" color={c.muted}>
                {money(r.month_paid)} من {money(r.monthly_goal)}
              </T>
            </Card>
          ))}

          <SectionTitle title="إجمالي التبرعات منذ البداية" />
          <Card style={{ gap: space.md }}>
            {[...rows]
              .sort((a, b) => b.all_time_total - a.all_time_total)
              .map((r) => (
                <View key={r.id} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="label">{r.name}</T>
                    <T v="caption" color={c.gold}>
                      {money(r.all_time_total)}
                    </T>
                  </Row>
                  <ProgressBar value={r.all_time_total / topAllTime} color={c.gold} height={6} />
                </View>
              ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
