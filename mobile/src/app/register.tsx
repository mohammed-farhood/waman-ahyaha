import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Chip, Empty, Field, LoadingCards, Row, Screen, T } from '@/components/ui';
import { PRIVACY_URL, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmt, normalizePhone } from '@/lib/format';
import { DEFAULT_PLEDGE, useGroups } from '@/lib/queries';
import { space, useColors } from '@/theme';

const AMOUNTS = [250, 1000, 5000, 10000, 15000, 25000, 50000];

export default function Register() {
  const c = useColors();
  const toast = useToast();
  const { register } = useAuth();
  const groups = useGroups();
  const list = groups.data ?? [];
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [amount, setAmount] = useState(DEFAULT_PLEDGE);
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!groupId && list.length === 1) setGroupId(list[0].id);
  }, [groupId, list]);

  const group = list.find((g) => g.id === groupId);

  const submit = async () => {
    const e: Record<string, string> = {};
    const p = normalizePhone(phone);
    if (name.trim().length < 2) e.name = 'اكتب اسمك (حرفان على الأقل)';
    if (!p) e.phone = 'أدخل رقم هاتف عراقي صحيح، مثل 07701234567';
    if (!groupId) e.group = 'اختر الحملة التي تتبرع لها';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await register({ name, phone: p as string, groupId: groupId as string, collectorId, amount, isAnonymous: anon });
      toast('تم تسجيلك بنجاح، جزاك الله خيراً');
      if (router.canDismiss()) router.dismissAll();
      router.replace('/home');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <T color={c.muted}>سجّل تبرعك الشهري لكفالة الأيتام. بعد التسجيل يمكنك متابعة حالة تبرعك كل شهر.</T>

      <Card style={{ gap: space.lg }}>
        <Field label="الاسم الكامل" icon="user" value={name} onChangeText={setName} error={errors.name} placeholder="مثال: محمد علي" textContentType="name" autoComplete="name" maxLength={100} />
        <Field
          label="رقم الهاتف"
          icon="phone"
          value={phone}
          onChangeText={setPhone}
          error={errors.phone}
          placeholder="07XXXXXXXXX"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          hint="ستدخل به إلى حسابك لاحقاً"
          maxLength={16}
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <T v="label">الحملة</T>
        {groups.isLoading ? (
          <LoadingCards count={1} />
        ) : list.length === 0 ? (
          <Empty icon="flag" title="لا توجد حملات متاحة حالياً" />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {list.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                active={g.id === groupId}
                onPress={() => {
                  setGroupId(g.id);
                  setCollectorId(null);
                }}
              />
            ))}
          </View>
        )}
        {errors.group ? (
          <T v="caption" color={c.danger}>
            {errors.group}
          </T>
        ) : null}

        {group && group.collectors.length > 0 && (
          <>
            <T v="label">جامع التبرعات (اختياري)</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip label="لاحقاً" active={!collectorId} onPress={() => setCollectorId(null)} />
              {group.collectors.map((col) => (
                <Chip key={col.id} label={col.name} active={collectorId === col.id} onPress={() => setCollectorId(col.id)} />
              ))}
            </View>
          </>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <T v="label">مبلغ التبرع الشهري</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {AMOUNTS.map((a) => (
            <Chip key={a} label={`${fmt(a)} د.ع`} active={amount === a} onPress={() => setAmount(a)} />
          ))}
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
          <View style={{ flex: 1 }}>
            <T v="label">التبرع كفاعل خير</T>
            <T v="caption" color={c.muted}>
              يظهر اسمك للمتبرعين الآخرين «فاعل خير»
            </T>
          </View>
          <Switch value={anon} onValueChange={setAnon} trackColor={{ true: c.primary, false: c.borderStrong }} thumbColor="#FFFFFF" />
        </Row>
      </Card>

      <Button title="تسجيل" icon="check" kind="gold" loading={busy} onPress={submit} />
      <T v="caption" color={c.muted} center>
        بالتسجيل أنت توافق على{' '}
        <T v="caption" color={c.primary} onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}>
          سياسة الخصوصية
        </T>
      </T>
      <Row style={{ justifyContent: 'center' }} gap={4}>
        <T color={c.muted}>لديك حساب؟</T>
        <Button small kind="ghost" title="تسجيل الدخول" onPress={() => router.replace('/login')} />
      </Row>
    </Screen>
  );
}
