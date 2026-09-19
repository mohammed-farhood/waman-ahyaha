import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native';

import { BrandMark } from '@/components/brand';
import { Badge, Button, Card, Empty, Icon, LoadingCards, Row, SectionTitle, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmt } from '@/lib/format';
import { useGroups } from '@/lib/queries';
import { radius, space, useColors } from '@/theme';

export default function Welcome() {
  const c = useColors();
  const { sessionExpired } = useAuth();
  const groups = useGroups();
  const list = groups.data ?? [];
  const orphans = list.reduce((s, g) => s + (g.orphans_sponsored || 0), 0);
  const donors = list.reduce((s, g) => s + (g.donor_count || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <View style={[styles.hero, { backgroundColor: c.heroFrom }]}>
          <View style={[styles.blob, { top: -70, right: -70, width: 240, height: 240, backgroundColor: 'rgba(255,255,255,0.05)' }]} />
          <View style={[styles.blob, { bottom: -50, left: -50, width: 180, height: 180, backgroundColor: 'rgba(200,169,42,0.08)' }]} />
          <SafeAreaView edges={['top']} style={{ alignItems: 'center', gap: space.md, paddingHorizontal: space.xl }}>
            <View style={{ marginTop: space.xl }}>
              <BrandMark size={84} />
            </View>
            <T v="display" color="#FFFFFF" center>
              ومن أحياها
            </T>
            <T v="heading" color={c.goldLight} center>
              ﴿وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا﴾
            </T>
            <T color="rgba(255,255,255,0.85)" center>
              منصة شفافة تُمكّن المجموعات الجامعية من متابعة تبرعاتها الشهرية لكفالة الأيتام وتحفيز المنافسة الإيجابية
            </T>

            {sessionExpired && (
              <View style={[styles.notice, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <Icon name="clock" size={16} color="#FFFFFF" />
                <T v="label" color="#FFFFFF">
                  انتهت جلستك، يرجى تسجيل الدخول مجدداً
                </T>
              </View>
            )}

            <View style={{ alignSelf: 'stretch', gap: space.md, marginTop: space.sm }}>
              <Button title="تسجيل الدخول" kind="gold" icon="log-in" onPress={() => router.push('/login')} />
              <Button
                title="انضم كمتبرع"
                kind="outline"
                icon="user-plus"
                onPress={() => router.push('/register')}
                tint="#FFFFFF"
                style={{ borderColor: 'rgba(255,255,255,0.55)' }}
              />
            </View>

            <Row style={[styles.stats, { borderTopColor: 'rgba(255,255,255,0.15)' }]} gap={0}>
              <HeroStat value={fmt(orphans)} label="يتيم مكفول" />
              <HeroStat value={fmt(list.length)} label="حملة نشطة" />
              <HeroStat value={fmt(donors)} label="متبرع" />
            </Row>
          </SafeAreaView>
        </View>

        <View style={{ padding: space.lg, gap: space.md }}>
          <Card onPress={() => router.push('/start-campaign')} style={{ borderStyle: 'dashed', borderColor: c.primary, borderWidth: 1.5 }}>
            <Row gap={space.md}>
              <View style={[styles.iconBox, { backgroundColor: c.primaryBg }]}>
                <Icon name="plus" color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="heading">تريد تأسيس حملة جديدة؟</T>
                <T v="caption" color={c.muted}>
                  أرسل طلبك وسنساعدك في إطلاق حملة كفالة في جامعتك
                </T>
              </View>
              <Icon name="chevron-left" color={c.muted} />
            </Row>
          </Card>

          <SectionTitle title="الحملات النشطة" />
          {groups.isLoading ? (
            <LoadingCards count={2} />
          ) : groups.error ? (
            <Empty icon="wifi-off" title="تعذّر تحميل الحملات" body="تحقق من اتصالك بالإنترنت" action={<Button small kind="soft" title="إعادة المحاولة" onPress={() => groups.refetch()} />} />
          ) : list.length === 0 ? (
            <Empty icon="flag" title="لا توجد حملات بعد" body="كن أول من يطلق حملة كفالة" />
          ) : (
            list.map((g) => (
              <Card key={g.id} style={{ gap: space.sm }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T v="heading">{g.name}</T>
                    {g.university ? (
                      <T v="caption" color={c.muted}>
                        {g.university}
                      </T>
                    ) : null}
                  </View>
                  <Badge label={`${fmt(g.orphans_sponsored)} يتيم`} tone="gold" icon="heart" />
                </Row>
                <Row gap={space.lg}>
                  <Row gap={4}>
                    <Icon name="users" size={14} color={c.muted} />
                    <T v="caption" color={c.muted}>
                      {fmt(g.donor_count)} متبرع
                    </T>
                  </Row>
                  <Row gap={4}>
                    <Icon name="user-check" size={14} color={c.muted} />
                    <T v="caption" color={c.muted}>
                      {fmt(g.collectors.length)} جامع تبرعات
                    </T>
                  </Row>
                </Row>
              </Card>
            ))
          )}

          <Button kind="ghost" icon="info" title="عن المنصة وتواصل معنا" onPress={() => router.push('/about')} />
        </View>
      </ScrollView>
    </View>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <T v="number" color={c.goldLight}>
        {value}
      </T>
      <T v="caption" color="rgba(255,255,255,0.75)">
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', paddingBottom: space.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  blob: { position: 'absolute', borderRadius: 999 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  stats: { alignSelf: 'stretch', marginTop: space.lg, paddingTop: space.lg, borderTopWidth: 1 },
  iconBox: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
