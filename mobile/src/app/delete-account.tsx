// In-app account deletion (required by the App Store and Google Play).
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Icon, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { space, useColors } from '@/theme';

const WORD = 'حذف';

export default function DeleteAccount() {
  const c = useColors();
  const toast = useToast();
  const { user, deleteAccount } = useUser();
  const donor = user.role === 'donor';
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = donor ? confirm.trim() === WORD : pin.length >= 4;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await deleteAccount(donor ? undefined : pin);
      toast('تم حذف حسابك. نسأل الله أن يتقبل منك.');
      if (router.canDismiss()) router.dismissAll();
      router.replace('/welcome');
    } catch (e) {
      toast(errorMessage(e), 'error');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: space.md, backgroundColor: c.dangerBg, borderColor: c.danger }}>
        <Row gap={space.sm}>
          <Icon name="alert-triangle" color={c.danger} />
          <T v="heading" color={c.danger}>
            حذف الحساب نهائي
          </T>
        </Row>
        <T>عند حذف حسابك:</T>
        <View style={{ gap: 4 }}>
          <T>• يُمحى اسمك ورقم هاتفك وربط التليجرام فوراً.</T>
          <T>• تُسجَّل مبالغ تبرعاتك السابقة باسم «مستخدم محذوف» حفاظاً على سجلات الحملة المالية.</T>
          {user.role === 'collector' && <T>• يصبح متبرعوك بلا جامع حتى يعيّن مسؤول الحملة جامعاً آخر.</T>}
          <T>• لا يمكن التراجع، لكن يمكنك التسجيل من جديد لاحقاً بالرقم نفسه.</T>
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        {donor ? (
          <Field label={`للتأكيد اكتب كلمة «${WORD}»`} value={confirm} onChangeText={setConfirm} autoCorrect={false} />
        ) : (
          <Field label="أدخل رمز الدخول (PIN) للتأكيد" icon="lock" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, ''))} secureTextEntry keyboardType="number-pad" maxLength={20} />
        )}
        <Button title="حذف حسابي نهائياً" kind="danger" icon="trash-2" loading={busy} disabled={!ready} onPress={submit} />
        <Button title="إلغاء" kind="ghost" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}
