// Link the donor's account to the campaign's Telegram bot (receipts + reminders).
// Flow: get a one-time code → open the bot with it → poll until the bot saw /start → attach.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Icon, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { attachTelegram, checkTelegramCode, requestTelegramCode } from '@/lib/queries';
import { space, useColors } from '@/theme';

type Phase = 'idle' | 'waiting' | 'done' | 'error';

export default function TelegramLink() {
  const c = useColors();
  const toast = useToast();
  const { user, patchUser } = useUser();
  const [phase, setPhase] = useState<Phase>(user.telegram_chat_id ? 'done' : 'idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<{ code: string; bot: string; started: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const poll = async () => {
    const s = session.current;
    if (!s) return;
    if (Date.now() - s.started > 3 * 60 * 1000) {
      stop();
      setPhase('error');
      setError('انتهت مهلة الربط. اضغط «ربط حسابي» للمحاولة من جديد.');
      return;
    }
    try {
      const r = await checkTelegramCode(s.code);
      if (r.status === 'linked') {
        stop();
        const a = await attachTelegram(user.id, s.code);
        patchUser({ telegram_chat_id: a.chatId });
        setPhase('done');
        toast('تم ربط حسابك بالتليجرام بنجاح');
      }
    } catch (e) {
      stop();
      setPhase('error');
      setError(errorMessage(e));
    }
  };

  // check immediately when the user comes back from Telegram
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && timer.current) poll();
    });
    return () => sub.remove();
  });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await requestTelegramCode();
      session.current = { code: r.code, bot: r.botUsername, started: Date.now() };
      setPhase('waiting');
      stop();
      timer.current = setInterval(poll, 3000);
      await Linking.openURL(`https://t.me/${r.botUsername}?start=${r.code}`);
    } catch (e) {
      setPhase('error');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: phase === 'done' ? c.successBg : c.infoBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={phase === 'done' ? 'check' : 'send'} size={32} color={phase === 'done' ? c.success : c.info} />
        </View>
        <T v="title" center>
          {phase === 'done' ? 'حسابك مرتبط بالتليجرام' : 'اربط حسابك بالتليجرام'}
        </T>
        <T color={c.muted} center>
          {phase === 'done' ? 'ستصلك إيصالات الدفع وتذكيرات الحملة عبر البوت.' : 'تصلك إيصالات الدفع فور تسجيلها، وتذكير لطيف إن فاتك موعد التبرع.'}
        </T>
      </Card>

      {phase === 'waiting' && (
        <Card style={{ gap: space.md }}>
          <Row gap={space.md}>
            <ActivityIndicator color={c.primary} />
            <T v="heading" style={{ flex: 1 }}>
              بانتظار التأكيد من تليجرام…
            </T>
          </Row>
          <T color={c.muted}>في تليجرام اضغط زر «ابدأ / Start» في محادثة البوت، ثم عُد إلى التطبيق.</T>
          <Button small kind="soft" icon="external-link" title="فتح البوت مرة أخرى" onPress={() => session.current && Linking.openURL(`https://t.me/${session.current.bot}?start=${session.current.code}`)} />
        </Card>
      )}

      {error ? (
        <T v="label" color={c.danger} center>
          {error}
        </T>
      ) : null}

      {phase === 'done' ? (
        <Button title="تم" icon="check" onPress={() => router.back()} />
      ) : (
        <Button title={phase === 'waiting' ? 'إعادة المحاولة' : 'ربط حسابي الآن'} icon="send" loading={busy} onPress={start} />
      )}
    </Screen>
  );
}
