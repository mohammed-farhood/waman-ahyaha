import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { BrandMark } from '@/components/brand';
import { useToast } from '@/components/toast';
import { Button, Card, Field, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localPhone, normalizePhone } from '@/lib/format';
import { space, useColors } from '@/theme';

export default function Login() {
  const c = useColors();
  const toast = useToast();
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<TextInput>(null);

  const submit = async () => {
    const p = normalizePhone(phone);
    if (!p) return setError('أدخل رقم هاتف عراقي صحيح، مثل 07701234567');
    if (needPin && pin.length < 4) return setError('أدخل رمز الدخول (4 أرقام على الأقل)');
    setError(null);
    setBusy(true);
    try {
      const r = await login(p, needPin ? pin : null);
      if (r.requirePin) {
        setNeedPin(true);
        setTimeout(() => pinRef.current?.focus(), 250);
        return;
      }
      toast('أهلاً بك');
      if (router.canDismiss()) router.dismissAll();
      router.replace('/home');
    } catch (e) {
      setError(errorMessage(e));
      if (needPin) setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']} contentStyle={{ paddingTop: space.xl }}>
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <View style={{ backgroundColor: c.heroFrom, borderRadius: 24, padding: 10 }}>
          <BrandMark size={52} />
        </View>
        <T v="title">مرحباً بعودتك</T>
        <T color={c.muted} center>
          {needPin ? 'حسابك محمي برمز دخول، أدخله للمتابعة' : 'أدخل رقم هاتفك المسجّل في الحملة'}
        </T>
      </View>

      <Card style={{ gap: space.lg }}>
        <Field
          label="رقم الهاتف"
          icon="phone"
          value={phone}
          onChangeText={(t) => {
            setPhone(t);
            setError(null);
          }}
          editable={!needPin}
          placeholder="07XXXXXXXXX"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="next"
          onSubmitEditing={submit}
          maxLength={16}
        />
        {needPin && (
          <>
            <Field
              ref={pinRef}
              label="رمز الدخول (PIN)"
              icon="lock"
              value={pin}
              onChangeText={(t) => {
                setPin(t.replace(/\D/g, ''));
                setError(null);
              }}
              secureTextEntry
              keyboardType="number-pad"
              textContentType="password"
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={submit}
              maxLength={20}
            />
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="caption" color={c.muted}>
                {localPhone(normalizePhone(phone))}
              </T>
              <Button
                small
                kind="ghost"
                title="تغيير الرقم"
                onPress={() => {
                  setNeedPin(false);
                  setPin('');
                  setError(null);
                }}
              />
            </Row>
          </>
        )}
        {error ? (
          <T v="label" color={c.danger} accessibilityLiveRegion="polite">
            {error}
          </T>
        ) : null}
        <Button title={needPin ? 'دخول' : 'متابعة'} icon="log-in" loading={busy} onPress={submit} />
      </Card>

      <Row style={{ justifyContent: 'center' }} gap={4}>
        <T color={c.muted}>لست مسجلاً بعد؟</T>
        <Button small kind="ghost" title="انضم كمتبرع" onPress={() => router.replace('/register')} />
      </Row>
    </Screen>
  );
}
