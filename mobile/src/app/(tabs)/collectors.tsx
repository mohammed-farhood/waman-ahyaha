import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { Avatar } from '@/components/brand';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Chip, Empty, Field, Icon, IconButton, LoadingCards, Row, Screen, SectionTitle, Sheet, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { fmt, intlPhone, localPhone, money, monthKey, monthLabel, timeAgo } from '@/lib/format';
import { acknowledgePayReport, createPayReport, isPaid, pledge, useCampaign, useInvalidate, usePayReports } from '@/lib/queries';
import { PayReport, User, isManager, isStaff } from '@/lib/types';
import { space, useColors } from '@/theme';

export default function Collectors() {
  const c = useColors();
  const { user } = useUser();
  const camp = useCampaign();
  const { group, groupId, collectors, donors, dmap } = camp;
  const staff = isStaff(user.role);
  const reports = usePayReports(groupId, staff);
  const [reporting, setReporting] = useState(false);
  const month = monthKey();

  return (
    <Screen
      refreshing={camp.refreshing || reports.isRefetching}
      onRefresh={() => {
        camp.refetch();
        if (staff) reports.refetch();
      }}>
      <PageHeader title="جامعو التبرعات" subtitle={group?.name} />

      {camp.loading ? (
        <LoadingCards count={3} />
      ) : collectors.length === 0 ? (
        <Empty icon="users" title="لا يوجد جامعو تبرعات بعد" body={isManager(user.role) ? 'أضف جامع تبرعات من صفحة حسابي' : undefined} />
      ) : (
        collectors.map((col) => {
          const mine = donors.filter((d) => d.collector_id === col.id);
          const paid = mine.filter((d) => isPaid(dmap, month, d.id)).length;
          const a = col.availability;
          const isMe = col.id === user.id;
          return (
            <Card key={col.id} style={{ gap: space.md, borderColor: isMe ? c.primary : c.border }}>
              <Row gap={space.md}>
                <Avatar name={col.name} size={48} />
                <View style={{ flex: 1 }}>
                  <Row gap={6}>
                    <T v="heading">{col.name}</T>
                    {isMe && <Badge label="أنت" />}
                  </Row>
                  {col.stage ? (
                    <T v="caption" color={c.muted}>
                      {col.stage}
                    </T>
                  ) : null}
                </View>
                {staff && <Badge label={`${fmt(paid)}/${fmt(mine.length)}`} tone={mine.length && paid === mine.length ? 'success' : 'primary'} />}
              </Row>
              {a && (a.days || a.startTime || a.location) ? (
                <View style={{ gap: 4 }}>
                  {a.days ? <Info icon="calendar" text={a.days} /> : null}
                  {a.startTime || a.endTime ? <Info icon="clock" text={[a.startTime, a.endTime].filter(Boolean).join(' — ')} /> : null}
                  {a.location ? <Info icon="map-pin" text={a.location} /> : null}
                </View>
              ) : (
                <T v="caption" color={c.subtle}>
                  لم يحدّد أوقات تواجده بعد
                </T>
              )}
              {col.phone && !isMe ? (
                <Row gap={space.sm}>
                  <Button small kind="soft" icon="phone" title="اتصال" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${col.phone}`)} />
                  <Button small kind="soft" icon="message-circle" title="واتساب" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/${intlPhone(col.phone)}`)} />
                  <Button small kind="soft" icon="send" title="تيليجرام" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://t.me/+${intlPhone(col.phone)}`)} />
                </Row>
              ) : null}
            </Card>
          );
        })
      )}

      {staff && groupId && (
        <>
          <SectionTitle title="بلاغات استلام التبرعات" action={<IconButton name="plus-circle" label="إضافة بلاغ استلام" onPress={() => setReporting(true)} />} />
          <T v="caption" color={c.muted}>
            إذا استلمت تبرعاً من متبرع يتبع جامعاً آخر، سجّل بلاغاً ليؤكده الجامع المسؤول عنه.
          </T>
          <PayReports reports={reports.data ?? []} loading={reports.isLoading} me={user} users={camp.users} groupId={groupId} month={month} />
          <ReportSheet visible={reporting} onClose={() => setReporting(false)} groupId={groupId} donors={donors} me={user} month={month} />
        </>
      )}
    </Screen>
  );
}

function Info({ icon, text }: { icon: 'calendar' | 'clock' | 'map-pin'; text: string }) {
  const c = useColors();
  return (
    <Row gap={6}>
      <Icon name={icon} size={14} color={c.primary} />
      <T v="caption" style={{ flex: 1 }}>
        {text}
      </T>
    </Row>
  );
}

function PayReports({ reports, loading, me, users, groupId, month }: { reports: PayReport[]; loading: boolean; me: User; users: User[]; groupId: string; month: string }) {
  const c = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const pending = reports.filter((r) => !r.acknowledged);
  const manager = isManager(me.role);
  const incoming = pending.filter((r) => r.donor_id && byId.get(r.donor_id)?.collector_id === me.id);
  const outgoing = pending.filter((r) => r.reporter_id === me.id);
  const others = manager ? pending.filter((r) => !incoming.includes(r) && !outgoing.includes(r)) : [];

  const confirm = async (r: PayReport) => {
    const donor = r.donor_id ? byId.get(r.donor_id) : undefined;
    setBusy(r.id);
    try {
      await acknowledgePayReport(r.id);
      // acknowledging doesn't touch the grid — mark the month paid too (same as the website)
      if (donor) await api('PUT', `/api/donations/${groupId}/${month}/${donor.id}`, { paid: true, amount: pledge(donor), collectorId: me.id });
      await invalidate('payReports', 'donations');
      toast('تم تأكيد الاستلام وتسجيل الدفع');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingCards count={1} />;
  if (!pending.length)
    return (
      <Card>
        <T color={c.muted} center>
          لا توجد بلاغات معلّقة
        </T>
      </Card>
    );

  const item = (r: PayReport, canConfirm: boolean) => {
    const donor = r.donor_id ? byId.get(r.donor_id) : undefined;
    const reporter = r.reporter_id ? byId.get(r.reporter_id) : undefined;
    return (
      <Card key={r.id} style={{ gap: space.sm }}>
        <Row>
          <T v="heading" style={{ flex: 1 }}>
            {donor?.name ?? 'متبرع'}
          </T>
          <T v="label" color={c.gold}>
            {money(r.amount)}
          </T>
        </Row>
        <T v="caption" color={c.muted}>
          {[`استلمه: ${reporter?.name ?? '—'}`, monthLabel(r.month_key), timeAgo(r.created_at)].join(' · ')}
        </T>
        {r.note ? <T v="caption">{r.note}</T> : null}
        {canConfirm ? (
          <Button small title="تأكيد الاستلام" icon="check" loading={busy === r.id} onPress={() => confirm(r)} />
        ) : (
          <Badge label="بانتظار تأكيد الجامع المسؤول" tone="warning" icon="clock" />
        )}
      </Card>
    );
  };

  return (
    <View style={{ gap: space.md }}>
      {incoming.length > 0 && <T v="label">واردة إليك ({fmt(incoming.length)})</T>}
      {incoming.map((r) => item(r, true))}
      {outgoing.length > 0 && <T v="label">أرسلتها ({fmt(outgoing.length)})</T>}
      {outgoing.map((r) => item(r, manager))}
      {others.length > 0 && <T v="label">بلاغات أخرى في الحملة ({fmt(others.length)})</T>}
      {others.map((r) => item(r, true))}
    </View>
  );
}

function ReportSheet({ visible, onClose, groupId, donors, me, month }: { visible: boolean; onClose: () => void; groupId: string; donors: User[]; me: User; month: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [search, setSearch] = useState('');
  const [donorId, setDonorId] = useState<string | null>(null);
  const [amount, setAmount] = useState('5000');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const candidates = donors.filter((d) => d.collector_id !== me.id && (!search.trim() || d.name.includes(search.trim())));

  const submit = async () => {
    const amt = parseInt(amount.replace(/\D/g, ''), 10);
    if (!donorId) return toast('اختر المتبرع', 'error');
    if (!amt) return toast('أدخل المبلغ المستلم', 'error');
    setBusy(true);
    try {
      await createPayReport({ groupId, donorId, monthKey: month, amount: amt, ...(note.trim() ? { note: note.trim() } : {}) });
      await invalidate('payReports');
      toast('تم إرسال البلاغ إلى الجامع المسؤول');
      setDonorId(null);
      setNote('');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="بلاغ استلام تبرع">
      <Field label="ابحث عن المتبرع" icon="search" value={search} onChangeText={setSearch} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {candidates.slice(0, 24).map((d) => (
          <Chip
            key={d.id}
            label={d.name}
            active={donorId === d.id}
            onPress={() => {
              setDonorId(d.id);
              setAmount(String(pledge(d)));
            }}
          />
        ))}
        {candidates.length === 0 && <T v="caption">لا يوجد متبرعون مطابقون</T>}
      </View>
      <Field label="المبلغ المستلم (د.ع)" value={amount} onChangeText={setAmount} keyboardType="number-pad" maxLength={9} />
      <Field label="ملاحظة (اختياري)" value={note} onChangeText={setNote} maxLength={500} />
      <Button title="إرسال البلاغ" icon="send" loading={busy} onPress={submit} />
    </Sheet>
  );
}
