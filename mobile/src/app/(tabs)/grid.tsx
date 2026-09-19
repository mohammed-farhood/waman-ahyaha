import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageHeader } from '@/components/page-header';
import { PayHowSheet } from '@/components/sheets';
import { useToast } from '@/components/toast';
import { Badge, Button, Chip, Empty, Field, IconButton, LoadingCards, Row, Sheet, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmt, localPhone, money, monthLabel, normalizePhone, recentMonths } from '@/lib/format';
import { GRID_MONTHS, addDonor, isPaid, pledge, sendReceipt, useCampaign, useInvalidate, useSetDonation, visibleDonors } from '@/lib/queries';
import { User, isManager, isStaff } from '@/lib/types';
import { font, radius, space, useColors } from '@/theme';

type Filter = 'all' | 'paid' | 'unpaid';
const NO_COLLECTOR = '__none__';

export default function Grid() {
  const c = useColors();
  const toast = useToast();
  const { user } = useUser();
  const camp = useCampaign();
  const { group, groupId, donors, collectors, dmap } = camp;
  const months = useMemo(() => recentMonths(GRID_MONTHS), []);
  const [month, setMonth] = useState(months[0]);
  const [filter, setFilter] = useState<Filter>('all');
  const [collectorFilter, setCollectorFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [payFor, setPayFor] = useState<User | null>(null);
  const [adding, setAdding] = useState(false);
  const setDonation = useSetDonation(groupId);
  const receipts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = receipts.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const staff = isStaff(user.role);
  const manager = isManager(user.role);
  const collectorName = useCallback((id: string | null) => collectors.find((x) => x.id === id)?.name, [collectors]);

  const base = useMemo(() => (staff ? visibleDonors(user, donors) : donors), [staff, user, donors]);
  const rows = useMemo(() => {
    const s = search.trim();
    return base
      .filter((d) => !collectorFilter || (collectorFilter === NO_COLLECTOR ? !d.collector_id : d.collector_id === collectorFilter))
      .filter((d) => filter === 'all' || (filter === 'paid') === isPaid(dmap, month, d.id))
      .filter((d) => !s || d.name.includes(s) || (d.phone ?? '').includes(s.replace(/^0/, '')))
      .sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name, 'ar')));
  }, [base, collectorFilter, filter, search, dmap, month, user.id]);

  const paidCount = base.filter((d) => isPaid(dmap, month, d.id)).length;
  const collected = base.reduce((s, d) => s + (dmap[month]?.[d.id]?.paid ? dmap[month][d.id].amount || 0 : 0), 0);

  const toggle = (donor: User) => {
    const prev = dmap[month]?.[donor.id];
    const nowPaid = !prev?.paid;
    const key = `${donor.id}:${month}`;
    const next = { paid: nowPaid, amount: nowPaid ? pledge(donor) : 0, collectorId: user.id };
    setDonation.mutate(
      { month, userId: donor.id, ...next },
      { onError: (e) => toast(errorMessage(e), 'error') },
    );
    clearTimeout(receipts.current.get(key));
    if (nowPaid && donor.telegram_chat_id) {
      // the receipt waits until the undo window has passed, like the website
      receipts.current.set(
        key,
        setTimeout(() => {
          receipts.current.delete(key);
          sendReceipt({ chatId: donor.telegram_chat_id as string, amount: next.amount, month: monthLabel(month), donorName: donor.name, collectorName: user.name }).catch(() => {});
        }, 5500),
      );
    }
    toast(nowPaid ? `تم تسجيل دفع ${donor.name}` : `أُلغي دفع ${donor.name}`, nowPaid ? 'success' : 'info', {
      action: {
        label: 'تراجع',
        onPress: () => {
          clearTimeout(receipts.current.get(key));
          receipts.current.delete(key);
          setDonation.mutate(
            { month, userId: donor.id, paid: !!prev?.paid, amount: prev?.amount ?? 0, collectorId: prev?.collector_id ?? null },
            { onError: (e) => toast(errorMessage(e), 'error') },
          );
        },
      },
    });
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <PageHeader
        title="جدول التبرعات"
        subtitle={group?.name}
        action={staff ? <IconButton name="user-plus" label="إضافة متبرع" onPress={() => setAdding(true)} /> : undefined}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {months.map((m, i) => (
          <Chip key={m} label={i === 0 ? `${monthLabel(m, false)} (الحالي)` : monthLabel(m)} active={m === month} onPress={() => setMonth(m)} />
        ))}
      </ScrollView>
      <Row style={[styles.summary, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <T v="label" color={c.muted}>
            {staff && user.role === 'collector' ? 'متبرعيّ' : 'المتبرعون'}
          </T>
          <T v="heading">
            سدّد {fmt(paidCount)} من {fmt(base.length)}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T v="label" color={c.muted}>
            المُحصّل
          </T>
          <T v="heading" color={c.gold}>
            {money(collected)}
          </T>
        </View>
      </Row>
      {staff && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          <Chip label="الكل" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="سدّدوا" active={filter === 'paid'} onPress={() => setFilter('paid')} />
          <Chip label="لم يسدّدوا" active={filter === 'unpaid'} onPress={() => setFilter('unpaid')} />
          {manager && collectors.length > 0 && <View style={{ width: 1, backgroundColor: c.border, marginHorizontal: 4 }} />}
          {manager &&
            collectors.map((col) => (
              <Chip key={col.id} label={col.name} active={collectorFilter === col.id} onPress={() => setCollectorFilter(collectorFilter === col.id ? null : col.id)} />
            ))}
          {manager && collectors.length > 0 && (
            <Chip label="بدون جامع" active={collectorFilter === NO_COLLECTOR} onPress={() => setCollectorFilter(collectorFilter === NO_COLLECTOR ? null : NO_COLLECTOR)} />
          )}
        </ScrollView>
      )}
      {base.length > 8 && <Field label="بحث" icon="search" value={search} onChangeText={setSearch} placeholder="اسم المتبرع أو رقمه" returnKeyType="search" />}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      {camp.loading ? (
        <View style={{ padding: space.lg, gap: space.lg }}>
          {header}
          <LoadingCards count={4} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(d) => d.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxxl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={camp.refreshing} onRefresh={camp.refetch} tintColor={c.primary} colors={[c.primary]} />}
          ListEmptyComponent={
            base.length === 0 ? (
              <Empty
                icon="users"
                title={user.role === 'collector' ? 'لا يوجد متبرعون في قائمتك بعد' : 'لا يوجد متبرعون بعد'}
                body={staff ? 'أضف أول متبرع من الزر أعلاه' : undefined}
                action={staff ? <Button small title="إضافة متبرع" icon="user-plus" onPress={() => setAdding(true)} /> : undefined}
              />
            ) : (
              <Empty icon="filter" title="لا نتائج تطابق التصفية" />
            )
          }
          renderItem={({ item: d }) => (
            <DonorRow
              donor={d}
              me={user}
              months={months}
              month={month}
              dmap={dmap}
              editable={staff}
              collectorName={manager ? collectorName(d.collector_id) : undefined}
              onToggle={() => toggle(d)}
              onPayHow={() => setPayFor(d)}
            />
          )}
        />
      )}
      <PayHowSheet donor={payFor} collector={collectors.find((x) => x.id === payFor?.collector_id) ?? null} month={month} onClose={() => setPayFor(null)} />
      {staff && groupId && <AddDonorSheet visible={adding} onClose={() => setAdding(false)} groupId={groupId} collectors={collectors} me={user} />}
    </SafeAreaView>
  );
}

function DonorRow({
  donor,
  me,
  months,
  month,
  dmap,
  editable,
  collectorName,
  onToggle,
  onPayHow,
}: {
  donor: User;
  me: User;
  months: string[];
  month: string;
  dmap: ReturnType<typeof useCampaign>['dmap'];
  editable: boolean;
  collectorName?: string;
  onToggle: () => void;
  onPayHow: () => void;
}) {
  const c = useColors();
  const paid = isPaid(dmap, month, donor.id);
  const self = donor.id === me.id;
  return (
    <View style={[styles.row, { backgroundColor: self ? c.primaryBg : c.surface, borderColor: self ? c.primary : c.border }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Row gap={6}>
          <T v="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
            {donor.name}
          </T>
          {self && <Badge label="أنت" />}
        </Row>
        <T v="caption" color={c.muted} numberOfLines={1}>
          {[money(pledge(donor)), collectorName ? `مسؤول: ${collectorName}` : null, editable && donor.phone ? localPhone(donor.phone) : null].filter(Boolean).join(' · ')}
        </T>
        <Row gap={5} accessibilityLabel="سجل آخر ستة أشهر">
          {months.map((m) => {
            const p = isPaid(dmap, m, donor.id);
            return <View key={m} style={[styles.dot, { backgroundColor: p ? c.success : 'transparent', borderColor: p ? c.success : m === month ? c.primary : c.borderStrong }]} />;
          })}
        </Row>
      </View>
      {editable ? (
        <Pressable
          accessibilityRole="switch"
          aria-checked={paid}
          testID={`toggle-${donor.id}`}
          accessibilityLabel={`${donor.name}: ${paid ? 'مسدّد' : 'غير مسدّد'} — ${monthLabel(month)}`}
          onPress={onToggle}
          hitSlop={6}
          style={({ pressed }) => [
            styles.toggle,
            { backgroundColor: paid ? c.success : c.surface, borderColor: paid ? c.success : c.borderStrong },
            pressed && { transform: [{ scale: 0.95 }] },
          ]}>
          <T v="label" color={paid ? '#FFFFFF' : c.muted} style={{ fontFamily: font.bold }}>
            {paid ? 'مسدّد' : 'لم يسدّد'}
          </T>
        </Pressable>
      ) : paid ? (
        <Badge label="مسدّد" tone="success" icon="check" />
      ) : self ? (
        <Button small kind="soft" title="طريقة السداد" onPress={onPayHow} />
      ) : (
        <Badge label="لم يسدّد" tone="muted" />
      )}
    </View>
  );
}

const AMOUNTS = [1000, 5000, 10000, 25000];

function AddDonorSheet({ visible, onClose, groupId, collectors, me }: { visible: boolean; onClose: () => void; groupId: string; collectors: User[]; me: User }) {
  const c = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('5000');
  const [anon, setAnon] = useState(false);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const manager = isManager(me.role);

  const reset = () => {
    setName('');
    setPhone('');
    setAmount('5000');
    setAnon(false);
    setCollectorId(null);
    setErrors({});
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    const p = normalizePhone(phone);
    const amt = parseInt(amount.replace(/\D/g, ''), 10);
    if (name.trim().length < 2) e.name = 'اكتب اسم المتبرع';
    if (!p) e.phone = 'رقم هاتف عراقي غير صحيح';
    if (!amt || amt < 0) e.amount = 'أدخل مبلغاً صحيحاً';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await addDonor({
        name: name.trim(),
        phone: p as string,
        amount: amt,
        isAnonymous: anon,
        ...(me.role === 'superadmin' ? { groupId } : {}),
        ...(manager ? { collectorId } : {}),
      });
      await invalidate('users');
      toast(r.linked ? `${r.user.name} مسجّل مسبقاً، أُضيف إلى القائمة` : `أُضيف ${r.user.name}`);
      reset();
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="إضافة متبرع">
      <Field label="الاسم" icon="user" value={name} onChangeText={setName} error={errors.name} maxLength={100} />
      <Field label="رقم الهاتف" icon="phone" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" placeholder="07XXXXXXXXX" maxLength={16} />
      <Field label="المبلغ الشهري (د.ع)" icon="dollar-sign" value={amount} onChangeText={setAmount} error={errors.amount} keyboardType="number-pad" maxLength={9} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {AMOUNTS.map((a) => (
          <Chip key={a} label={fmt(a)} active={amount === String(a)} onPress={() => setAmount(String(a))} />
        ))}
      </View>
      {manager && collectors.length > 0 && (
        <>
          <T v="label">جامع التبرعات</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip label="بدون" active={!collectorId} onPress={() => setCollectorId(null)} />
            {collectors.map((col) => (
              <Chip key={col.id} label={col.name} active={collectorId === col.id} onPress={() => setCollectorId(col.id)} />
            ))}
          </View>
        </>
      )}
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="label">التبرع كفاعل خير</T>
        <Switch value={anon} onValueChange={setAnon} trackColor={{ true: c.primary, false: c.borderStrong }} thumbColor="#FFFFFF" />
      </Row>
      <Button title="إضافة" icon="check" loading={busy} onPress={submit} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  toggle: { minWidth: 86, height: 40, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
});
