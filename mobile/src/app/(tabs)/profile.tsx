import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ReactNode, useMemo, useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';

import { Avatar } from '@/components/brand';
import { ReminderSheet } from '@/components/sheets';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Field, Icon, IconName, Row, Screen, SectionTitle, Sheet, T } from '@/components/ui';
import { API_URL, PRIVACY_URL, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { localPhone, monthKey, normalizePhone } from '@/lib/format';
import { isPaid, registerCollector, updateUser, useCampaign, useInvalidate } from '@/lib/queries';
import { Availability, ROLE_LABEL, User, isManager } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

export default function Profile() {
  const c = useColors();
  const toast = useToast();
  const { user, logout, patchUser } = useUser();
  const camp = useCampaign();
  const { group, donors, dmap } = camp;
  const [editAvail, setEditAvail] = useState(false);
  const [addCollector, setAddCollector] = useState(false);
  const [remind, setRemind] = useState(false);
  const [anonBusy, setAnonBusy] = useState(false);

  const unpaidMine = useMemo(
    () => (user.role === 'collector' ? donors.filter((d) => d.collector_id === user.id && !isPaid(dmap, monthKey(), d.id)) : []),
    [donors, dmap, user],
  );

  const confirmLogout = () =>
    Alert.alert('تسجيل الخروج', 'هل تريد تسجيل الخروج من التطبيق؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'خروج',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/welcome');
        },
      },
    ]);

  const toggleAnon = async (v: boolean) => {
    setAnonBusy(true);
    try {
      const r = await updateUser(user.id, { isAnonymous: v });
      patchUser({ is_anonymous: r.user.is_anonymous });
      toast(v ? 'سيظهر اسمك للمتبرعين «فاعل خير»' : 'سيظهر اسمك للمتبرعين');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setAnonBusy(false);
    }
  };

  const a = user.availability;

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
        <Avatar name={user.name} size={72} />
        <T v="title">{user.name}</T>
        <Badge label={ROLE_LABEL[user.role]} tone={user.role === 'donor' ? 'primary' : 'gold'} />
        <T v="caption" color={c.muted}>
          {[group?.name, localPhone(user.phone)].filter(Boolean).join(' · ')}
        </T>
      </Card>

      {user.role === 'donor' && (
        <>
          <SectionTitle title="إعداداتي" />
          <Card style={{ gap: space.lg }}>
            {group?.bot_username ? (
              user.telegram_chat_id ? (
                <Row gap={space.md}>
                  <Icon name="send" color={c.success} />
                  <T style={{ flex: 1 }}>حسابك مرتبط ببوت التليجرام</T>
                  <Badge label="مرتبط" tone="success" icon="check" />
                </Row>
              ) : (
                <Item icon="send" title="ربط حسابي بالتليجرام" subtitle="لتصلك الإيصالات والتذكيرات" onPress={() => router.push('/telegram')} />
              )
            ) : null}
            <Row gap={space.md}>
              <Icon name="eye-off" color={c.primary} />
              <View style={{ flex: 1 }}>
                <T v="label">التبرع كفاعل خير</T>
                <T v="caption" color={c.muted}>
                  يُخفى اسمك عن المتبرعين الآخرين
                </T>
              </View>
              <Switch value={!!user.is_anonymous} disabled={anonBusy} onValueChange={toggleAnon} trackColor={{ true: c.primary, false: c.borderStrong }} thumbColor="#FFFFFF" />
            </Row>
          </Card>
        </>
      )}

      {user.role === 'collector' && (
        <>
          <SectionTitle title="أوقات تواجدي" action={<Button small kind="ghost" title="تعديل" icon="edit-2" onPress={() => setEditAvail(true)} />} />
          <Card style={{ gap: 6 }}>
            {a && (a.days || a.startTime || a.location) ? (
              <>
                {a.days ? <T>الأيام: {a.days}</T> : null}
                {a.startTime || a.endTime ? <T>الوقت: {[a.startTime, a.endTime].filter(Boolean).join(' — ')}</T> : null}
                {a.location ? <T>المكان: {a.location}</T> : null}
              </>
            ) : (
              <T color={c.muted}>حدّد متى وأين يمكن للمتبرعين تسليمك التبرعات</T>
            )}
          </Card>
          <Button kind="soft" icon="bell" title="إرسال تذكير لمتبرعيّ" onPress={() => setRemind(true)} />
        </>
      )}

      {isManager(user.role) && (
        <>
          <SectionTitle title="إدارة الحملة" />
          <Card style={{ gap: space.lg }}>
            {user.role === 'admin' && <Item icon="user-plus" title="إضافة جامع تبرعات" onPress={() => setAddCollector(true)} />}
            {user.role === 'superadmin' && camp.groupId && <Item icon="user-plus" title="إضافة جامع تبرعات لهذه الحملة" onPress={() => setAddCollector(true)} />}
            {camp.groupId && <Item icon="send" title="بوت التليجرام للحملة" subtitle={group?.name} onPress={() => router.push({ pathname: '/bot-settings', params: { groupId: camp.groupId as string } })} />}
            {user.role === 'superadmin' && <Item icon="cpu" title="بوت التليجرام الافتراضي" subtitle="يُستخدم للحملات التي ليس لها بوت خاص" onPress={() => router.push({ pathname: '/bot-settings', params: { groupId: 'default' } })} />}
            <Item icon="inbox" title="رسائل الدعم" subtitle={user.role === 'superadmin' ? 'وطلبات تأسيس الحملات' : undefined} onPress={() => router.push('/inbox')} />
            {user.role === 'superadmin' && (
              <Item icon="external-link" title="إدارة الحملات والنسخ الاحتياطي" subtitle="إنشاء الحملات وحذفها والتصدير متاحة من موقع المنصة" onPress={() => WebBrowser.openBrowserAsync(API_URL)} />
            )}
          </Card>
        </>
      )}

      <SectionTitle title="عام" />
      <Card style={{ gap: space.lg }}>
        <Item icon="info" title="عن المنصة وتواصل معنا" onPress={() => router.push('/about')} />
        <Item icon="shield" title="سياسة الخصوصية" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} />
        <Item icon="log-out" title="تسجيل الخروج" onPress={confirmLogout} />
        {user.role !== 'superadmin' && <Item icon="trash-2" title="حذف حسابي" danger onPress={() => router.push('/delete-account')} />}
      </Card>

      <T v="caption" color={c.subtle} center>
        ومن أحياها · الإصدار {Constants.expoConfig?.version ?? '1.0.0'}
      </T>

      {user.role === 'collector' && <AvailabilitySheet visible={editAvail} onClose={() => setEditAvail(false)} user={user} onSaved={(av) => patchUser({ availability: av })} />}
      {isManager(user.role) && camp.groupId && <AddCollectorSheet visible={addCollector} onClose={() => setAddCollector(false)} groupId={camp.groupId} />}
      <ReminderSheet visible={remind} onClose={() => setRemind(false)} group={group} unpaid={unpaidMine} />
    </Screen>
  );
}

function Item({ icon, title, subtitle, onPress, danger, right }: { icon: IconName; title: string; subtitle?: string; onPress: () => void; danger?: boolean; right?: ReactNode }) {
  const c = useColors();
  const color = danger ? c.danger : c.primary;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Row gap={space.md}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: danger ? c.dangerBg : c.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="label" color={danger ? c.danger : c.heading}>
            {title}
          </T>
          {subtitle ? (
            <T v="caption" color={c.muted}>
              {subtitle}
            </T>
          ) : null}
        </View>
        {right ?? <Icon name="chevron-left" size={18} color={c.subtle} />}
      </Row>
    </Pressable>
  );
}

function AvailabilitySheet({ visible, onClose, user, onSaved }: { visible: boolean; onClose: () => void; user: User; onSaved: (a: Availability) => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const cur = user.availability ?? {};
  const [days, setDays] = useState(cur.days ?? '');
  const [startTime, setStart] = useState(cur.startTime ?? '');
  const [endTime, setEnd] = useState(cur.endTime ?? '');
  const [location, setLocation] = useState(cur.location ?? '');
  const [busy, setBusy] = useState(false);
  const timeOk = (t: string) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

  const save = async () => {
    if (!timeOk(startTime) || !timeOk(endTime)) return toast('اكتب الوقت بصيغة 24 ساعة، مثل 09:30 أو 14:00', 'error');
    setBusy(true);
    try {
      const availability = { days: days.trim(), startTime, endTime, location: location.trim() };
      await updateUser(user.id, { availability });
      onSaved(availability);
      await invalidate('users');
      toast('تم حفظ أوقات التواجد');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="أوقات تواجدي">
      <Field label="الأيام" value={days} onChangeText={setDays} placeholder="مثال: الأحد — الخميس" maxLength={100} />
      <Row gap={space.md}>
        <View style={{ flex: 1 }}>
          <Field label="من" value={startTime} onChangeText={setStart} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="إلى" value={endTime} onChangeText={setEnd} placeholder="14:00" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </Row>
      <Field label="المكان" value={location} onChangeText={setLocation} placeholder="مثال: كلية الهندسة — الطابق الثاني" maxLength={200} />
      <Button title="حفظ" icon="check" loading={busy} onPress={save} />
    </Sheet>
  );
}

function AddCollectorSheet({ visible, onClose, groupId }: { visible: boolean; onClose: () => void; groupId: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const e: Record<string, string> = {};
    const p = normalizePhone(phone);
    if (name.trim().length < 2) e.name = 'اكتب اسم الجامع';
    if (!p) e.phone = 'رقم هاتف عراقي غير صحيح';
    if (pin.length < 4) e.pin = 'رمز الدخول 4 أرقام على الأقل';
    else if (/^(\d)\1+$/.test(pin) || ['1234', '12345', '123456', '4321', '0123', '1212', '123123'].includes(pin)) e.pin = 'رمز سهل التخمين، اختر رمزاً آخر';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await registerCollector({ name: name.trim(), phone: p as string, pin, groupId, ...(stage.trim() ? { stage: stage.trim() } : {}) });
      await invalidate('users', 'groups');
      toast(`أُضيف ${name.trim()}، أرسل له رقمه ورمز دخوله`);
      setName('');
      setPhone('');
      setPin('');
      setStage('');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="إضافة جامع تبرعات">
      <Field label="الاسم" icon="user" value={name} onChangeText={setName} error={errors.name} maxLength={100} />
      <Field label="رقم الهاتف" icon="phone" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" placeholder="07XXXXXXXXX" maxLength={16} />
      <Field
        label="رمز الدخول (PIN)"
        icon="lock"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
        error={errors.pin}
        keyboardType="number-pad"
        maxLength={20}
        hint="سيدخل به الجامع إلى حسابه"
      />
      <Field label="المرحلة الدراسية (اختياري)" value={stage} onChangeText={setStage} placeholder="مثال: المرحلة الرابعة" maxLength={50} />
      <Button title="إضافة" icon="check" loading={busy} onPress={submit} />
    </Sheet>
  );
}
