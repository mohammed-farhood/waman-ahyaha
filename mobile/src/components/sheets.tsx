// Bottom sheets shared by several screens: "how to pay" and "send reminder".
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { errorMessage } from '@/lib/api';
import { fmt, intlPhone, localPhone, monthKey, monthLabel } from '@/lib/format';
import { pledge, sendReminders } from '@/lib/queries';
import { Group, User } from '@/lib/types';
import { radius, space, useColors } from '@/theme';
import { Avatar } from './brand';
import { useToast } from './toast';
import { Badge, Button, Card, Empty, Field, Row, Sheet, T } from './ui';

export function PayHowSheet({ donor, collector, month, onClose }: { donor: User | null; collector: User | null; month: string; onClose: () => void }) {
  const c = useColors();
  if (!donor) return null;
  return (
    <Sheet visible onClose={onClose} title="طريقة السداد">
      <Card style={{ gap: space.xs, backgroundColor: c.goldBg, borderColor: c.goldBg }}>
        <T v="label" color={c.muted}>
          {monthLabel(month)}
        </T>
        <T v="number" color={c.gold}>
          {fmt(pledge(donor))} د.ع
        </T>
        <T v="caption" color={c.muted}>
          المبلغ الشهري المطلوب
        </T>
      </Card>
      <T>سلّم مبلغ تبرعك نقداً إلى جامع التبرعات الخاص بك، وسيقوم بتأشير الدفع في جدول الحملة فيظهر لك مباشرة.</T>
      {collector ? (
        <Card style={{ gap: space.md }}>
          <Row gap={space.md}>
            <Avatar name={collector.name} />
            <View style={{ flex: 1 }}>
              <T v="heading">{collector.name}</T>
              <T v="caption" color={c.muted}>
                {[collector.stage, localPhone(collector.phone)].filter(Boolean).join(' · ')}
              </T>
            </View>
          </Row>
          {collector.phone ? (
            <Row gap={space.sm}>
              <Button small kind="soft" icon="phone" title="اتصال" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${collector.phone}`)} />
              <Button small kind="soft" icon="message-circle" title="واتساب" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/${intlPhone(collector.phone)}`)} />
            </Row>
          ) : null}
        </Card>
      ) : (
        <Card>
          <T color={c.muted}>لم يُحدَّد جامع تبرعات لك بعد. تواصل مع مسؤول الحملة أو اختر أحد المسؤولين من تبويب «المسؤولون».</T>
        </Card>
      )}
    </Sheet>
  );
}

export function reminderText(group: Group, extra?: string) {
  const base = `السلام عليكم ورحمة الله\n\nتذكير بموعد تبرع كفالة الأيتام — ${monthLabel(monthKey())}\n${group.name}\n\nالمبلغ المطلوب لكل يتيم: ${fmt(group.cost_per_orphan || 25000)} دينار`;
  return extra ? `${base}\n\nملاحظة من المسؤول:\n${extra}\n\nجزاكم الله خيراً` : `${base}\n\nيُرجى التواصل مع جامع التبرعات في أسرع وقت.\nجزاكم الله خيراً\nإدارة تطبيق ومن أحياها`;
}

export function ReminderSheet({ visible, onClose, group, unpaid }: { visible: boolean; onClose: () => void; group: Group | null; unpaid: User[] }) {
  const c = useColors();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!group) return null;
  const linked = unpaid.filter((d) => d.telegram_chat_id);
  const plain = reminderText(group);

  const sendBot = async (targets: User[]) => {
    const withTg = targets.filter((d) => d.telegram_chat_id);
    if (!withTg.length) return toast('لا يوجد متبرعون مرتبطون ببوت التليجرام في هذه القائمة', 'info');
    setBusy(true);
    try {
      const text = reminderText(group, note.trim() || undefined);
      const r = await sendReminders(withTg.map((d) => ({ chatId: d.telegram_chat_id as string, text: `مرحباً ${d.name},\n\n${text}` })));
      toast(`تمت إضافة ${fmt(r.count)} تذكير لطابور الإرسال عبر التليجرام`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="إرسال تذكير التبرع">
      <T color={c.muted}>{unpaid.length ? `${fmt(unpaid.length)} متبرع لم يسدّدوا بعد هذا الشهر` : 'جميع المتبرعين سدّدوا هذا الشهر'}</T>
      {unpaid.length === 0 ? (
        <Empty icon="check-circle" title="ما شاء الله، لا يوجد متأخرون" />
      ) : (
        <>
          <View style={{ backgroundColor: c.warningBg, borderRadius: radius.md, padding: space.md, gap: 4 }}>
            <T v="label" color={c.warning}>
              نص التذكير
            </T>
            <T v="caption">{plain}</T>
          </View>
          <Field label="تعليق إضافي (يُرسل عبر البوت فقط)" value={note} onChangeText={setNote} placeholder="مثال: خذ وقتك يا بطل، فقط للتذكير..." multiline maxLength={500} />
          <Row gap={space.sm}>
            <Button title={`عبر البوت (${fmt(linked.length)})`} icon="send" loading={busy} disabled={!linked.length} onPress={() => sendBot(unpaid)} style={{ flex: 1 }} />
            <Button title="واتساب" kind="outline" icon="message-circle" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(plain)}`)} style={{ flex: 1 }} />
          </Row>
          <T v="label">إرسال فردي</T>
          {unpaid.slice(0, 30).map((d) => (
            <Row key={d.id} style={{ paddingVertical: space.xs }}>
              <View style={{ flex: 1 }}>
                <T v="heading">{d.name}</T>
                {d.telegram_chat_id ? <Badge label="مرتبط بالبوت" tone="success" icon="check" /> : <T v="caption" color={c.muted}>{localPhone(d.phone)}</T>}
              </View>
              {d.telegram_chat_id ? (
                <Button small title="بالبوت" icon="send" onPress={() => sendBot([d])} />
              ) : d.phone ? (
                <Button small kind="soft" icon="message-circle" title="واتساب" onPress={() => Linking.openURL(`https://wa.me/${intlPhone(d.phone)}?text=${encodeURIComponent(plain)}`)} />
              ) : (
                <T v="caption" color={c.muted}>
                  لا يوجد رقم
                </T>
              )}
            </Row>
          ))}
        </>
      )}
    </Sheet>
  );
}
