import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Icon, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localPhone, normalizePhone } from '@/lib/format';
import { sendCampaignRequest } from '@/lib/queries';
import { radius, space, useColors } from '@/theme';

const CONTACT = '9647777961845';
const STEPS = [
  'تواصل معنا عبر النموذج أدناه أو مباشرةً عبر الواتساب. سنرشدك خطوة بخطوة.',
  'حدّد المجموعة الجامعية أو الفريق الذي سيدير الحملة معك.',
  'نقوم بإعداد المنصة لك وإضافة جامعي التبرعات والمتبرعين.',
];

export default function StartCampaign() {
  const c = useColors();
  const toast = useToast();
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(localPhone(user?.phone));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'اكتب اسمك';
    if (!normalizePhone(phone)) e.phone = 'أدخل رقم هاتف صحيح لنتواصل معك';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await sendCampaignRequest({ name, phone: normalizePhone(phone) as string, message });
      toast('تم إرسال طلبك، سنتواصل معك قريباً إن شاء الله');
      router.back();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const wa = `https://wa.me/${CONTACT}?text=${encodeURIComponent('السلام عليكم، أريد تأسيس حملة كفالة أيتام جديدة على منصة ومن أحياها')}`;

  return (
    <Screen edges={['bottom']}>
      <Card style={{ backgroundColor: c.heroFrom, borderColor: c.heroFrom, alignItems: 'center', gap: space.sm }}>
        <Icon name="star" size={30} color={c.goldLight} />
        <T v="title" color="#FFFFFF" center>
          ابدأ حملتك على منصة ومن أحياها
        </T>
        <T color="rgba(255,255,255,0.85)" center>
          نرحب بكل من يريد إطلاق حملة تبرعات جديدة. نحن هنا لمساعدتك!
        </T>
      </Card>

      <Card style={{ gap: space.md }}>
        <T v="heading">كيف تبدأ حملتك؟</T>
        {STEPS.map((s, i) => (
          <Row key={i} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: c.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
              <T v="label" color={c.primary}>
                {i + 1}
              </T>
            </View>
            <T style={{ flex: 1 }}>{s}</T>
          </Row>
        ))}
      </Card>

      <Card style={{ gap: space.lg }}>
        <T v="heading">أرسل طلبك</T>
        <Field label="الاسم" icon="user" value={name} onChangeText={setName} error={errors.name} maxLength={100} />
        <Field label="رقم الهاتف" icon="phone" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" placeholder="07XXXXXXXXX" maxLength={16} />
        <Field
          label="رسالتك (اختياري)"
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder="اسم الجامعة، عدد الطلاب المتوقع، أي تفاصيل تساعدنا..."
          maxLength={2000}
          style={{ minHeight: 90, textAlignVertical: 'top' }}
        />
        <Button title="إرسال الطلب" icon="send" loading={busy} onPress={submit} />
      </Card>

      <Row style={{ justifyContent: 'center' }} gap={space.md}>
        <Button small kind="soft" icon="message-circle" title="واتساب" onPress={() => Linking.openURL(wa)} />
        <Button small kind="soft" icon="send" title="تيليجرام" onPress={() => Linking.openURL(`https://t.me/+${CONTACT}`)} />
      </Row>
    </Screen>
  );
}
