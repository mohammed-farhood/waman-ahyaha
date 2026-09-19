import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Icon, IconName, Row, Screen, SectionTitle, T } from '@/components/ui';
import { PRIVACY_URL, errorMessage } from '@/lib/api';
import { sendSupportMessage } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { radius, space, useColors } from '@/theme';

const CONTACT = '9647777961845';

const STEPS: [IconName, string, string][] = [
  ['heart', 'تعهّد شهري واضح', 'كل متبرع يحدد مبلغه الشهري، ويرى حالة تبرعه لكل شهر في جدول الحملة.'],
  ['users', 'مسؤول جمع لكل متبرع', 'يستلم مسؤول الجمع التبرعات ويؤكدها في الجدول، فتظهر فوراً لإدارة الحملة.'],
  ['bar-chart-2', 'شفافية ومنافسة إيجابية', 'نسبة إنجاز كل حملة وعدد الأيتام المكفولين أمام الجميع، مع تذكيرات عبر تليجرام.'],
];

export default function About() {
  const c = useColors();
  const toast = useToast();
  const { user } = useAuth();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = msg.trim();
    if (!text) return toast('اكتب رسالتك أولاً', 'error');
    setBusy(true);
    try {
      await sendSupportMessage({ text, name: user?.name });
      setMsg('');
      toast('تم إرسال رسالتك بنجاح. سيتم الرد عليك قريباً.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Card style={{ alignItems: 'center', gap: space.sm, backgroundColor: c.heroFrom, borderColor: c.heroFrom }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="heart" size={26} color={c.goldLight} />
        </View>
        <T v="title" color="#FFFFFF">
          ومن أحياها
        </T>
        <T v="heading" color={c.goldLight} center>
          ﴿وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا﴾
        </T>
        <T color="rgba(255,255,255,0.88)" center>
          منصة لتنظيم حملات الكفالة الشهرية للأيتام التي يديرها طلاب الجامعات: المتبرع يعرف أين وصل تبرعه، ومسؤول الجمع يتابع قائمته بسهولة.
        </T>
      </Card>

      <SectionTitle title="كيف تعمل المنصة" />
      {STEPS.map(([icon, title, desc]) => (
        <Card key={title}>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: 42, height: 42, borderRadius: radius.md, backgroundColor: c.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} color={c.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="heading">{title}</T>
              <T color={c.muted}>{desc}</T>
            </View>
          </Row>
        </Card>
      ))}

      <Card style={{ gap: space.md, borderTopWidth: 3, borderTopColor: c.gold }}>
        <Row>
          <Icon name="mail" size={18} />
          <T v="heading">تواصل مع إدارة المنصة</T>
        </Row>
        <T color={c.muted}>اكتب سؤالك أو ملاحظتك هنا، أو إن كنت تريد إطلاق حملة كفالة في جامعتك. تصل الرسالة إلى إدارة المنصة فقط.</T>
        <Field label="رسالتك" value={msg} onChangeText={setMsg} placeholder="اكتب رسالتك هنا..." multiline maxLength={2000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
        <Button title="إرسال الرسالة" kind="gold" icon="send" loading={busy} onPress={send} />
        <Row style={{ justifyContent: 'center' }} gap={space.md}>
          <Button small kind="soft" icon="message-circle" title="واتساب" onPress={() => Linking.openURL(`https://wa.me/${CONTACT}`)} />
          <Button small kind="soft" icon="send" title="تيليجرام" onPress={() => Linking.openURL(`https://t.me/+${CONTACT}`)} />
        </Row>
      </Card>

      <Button kind="ghost" icon="shield" title="سياسة الخصوصية" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} />
    </Screen>
  );
}
