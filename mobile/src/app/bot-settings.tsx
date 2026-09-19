// Paste a Telegram bot token for one campaign (admin / superadmin) or for the whole platform
// (superadmin, groupId === 'default'). No server access needed — same as the website.
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Button, Card, Field, Icon, LoadingCards, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { ltr } from '@/lib/format';
import { removeCampaignBot, removeDefaultBot, setCampaignBot, setDefaultBot, useDefaultBot, useGroupTelegram, useGroups, useInvalidate } from '@/lib/queries';
import { radius, space, useColors } from '@/theme';

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

export default function BotSettings() {
  const c = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const isDefault = groupId === 'default';
  const campaign = useGroupTelegram(isDefault ? null : groupId);
  const platform = useDefaultBot(isDefault);
  const groups = useGroups();
  const group = groups.data?.find((g) => g.id === groupId);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const loading = isDefault ? platform.isLoading : campaign.isLoading;
  const current = isDefault ? (platform.data?.connected ? platform.data.username : null) : campaign.data?.ownBot ?? null;
  const fallback = isDefault ? null : campaign.data?.defaultBot ?? null;
  const fromEnv = isDefault && platform.data?.source === 'env';

  const refresh = () => Promise.all([invalidate('groupTelegram', 'defaultBot', 'groups')]);

  const save = async () => {
    const t = token.trim();
    if (!TOKEN_RE.test(t)) return toast('التوكن غير صالح — تأكد أنك نسخته كاملاً من BotFather', 'error');
    setBusy(true);
    try {
      const r = isDefault ? await setDefaultBot(t) : await setCampaignBot(groupId, t);
      setToken('');
      await refresh();
      toast(`تم تفعيل البوت ${ltr(`@${r.username}`)}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert('إزالة البوت', fallback ? 'ستعود الحملة لاستخدام بوت المنصة.' : 'ستتوقف التذكيرات والإيصالات عبر التليجرام.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إزالة',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            if (isDefault) await removeDefaultBot();
            else await removeCampaignBot(groupId);
            await refresh();
            toast('تمت إزالة البوت');
          } catch (e) {
            toast(errorMessage(e), 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const status = current
    ? { tone: c.success, bg: c.successBg, icon: 'check-circle' as const, title: `البوت مفعّل: ${ltr(`@${current}`)}`, body: isDefault ? (fromEnv ? 'مضبوط من ملف إعدادات الخادم. أي توكن تحفظه هنا يحل محله.' : 'تستخدمه الحملات التي ليس لها بوت خاص.') : 'التذكيرات والإيصالات وربط حسابات المتبرعين تتم عبر هذا البوت.' }
    : fallback
      ? { tone: c.info, bg: c.infoBg, icon: 'send' as const, title: `تستخدم الحملة بوت المنصة ${ltr(`@${fallback}`)}`, body: 'يمكنك إضافة بوت خاص باسم حملتك بدلاً منه.' }
      : { tone: c.warning, bg: c.warningBg, icon: 'alert-triangle' as const, title: 'لا يوجد بوت مفعّل', body: 'تذكيرات التليجرام والإيصالات وربط حسابات المتبرعين متوقفة حتى تضيف بوتاً.' };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: isDefault ? 'بوت المنصة الافتراضي' : 'بوت التليجرام للحملة' }} />
      {!isDefault && group ? (
        <T color={c.muted} center>
          {group.name}
        </T>
      ) : null}
      {loading ? (
        <LoadingCards count={1} />
      ) : (
        <View style={{ backgroundColor: status.bg, borderRadius: radius.lg, padding: space.lg, gap: 4 }}>
          <Row gap={space.sm}>
            <Icon name={status.icon} color={status.tone} />
            <T v="heading" color={status.tone} style={{ flex: 1 }}>
              {status.title}
            </T>
          </Row>
          <T v="caption">{status.body}</T>
        </View>
      )}

      <Card style={{ gap: space.sm }}>
        <T v="heading">كيف أحصل على توكن البوت؟ (دقيقة واحدة)</T>
        <T>١. افتح تليجرام وابحث عن {ltr('@BotFather')} (عليه علامة التوثيق الزرقاء).</T>
        <T>٢. أرسل له الأمر {ltr('/newbot')} ثم اكتب اسماً للبوت، ثم معرّفاً إنكليزياً ينتهي بـ {ltr('bot')}.</T>
        <T>٣. سيرسل لك رسالة فيها التوكن مثل {ltr('123456789:AAH…')} — انسخه كاملاً وألصقه في الأسفل.</T>
        <Button small kind="soft" icon="external-link" title="فتح BotFather" onPress={() => Linking.openURL('https://t.me/BotFather')} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Field
          label={current ? 'استبدال التوكن' : 'توكن البوت'}
          value={token}
          onChangeText={setToken}
          placeholder="123456789:AAH..."
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          hint="نتحقق من التوكن مع تليجرام قبل الحفظ، ويُحفظ مشفّراً ولا يظهر لأحد بعدها."
          style={{ writingDirection: 'ltr' }}
        />
        <Button
          small
          kind="ghost"
          icon="clipboard"
          title="لصق من الحافظة"
          onPress={async () => setToken((await Clipboard.getStringAsync()).trim())}
        />
        <Button title="حفظ وتفعيل البوت" icon="send" loading={busy} onPress={save} />
        {current && !fromEnv ? <Button kind="ghost" title={`إزالة البوت${fallback ? ' (والرجوع لبوت المنصة)' : ''}`} onPress={remove} tint={c.danger} /> : null}
      </Card>
    </Screen>
  );
}
