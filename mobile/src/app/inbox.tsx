// Support messages (admin: own campaign, superadmin: all) and new-campaign requests (superadmin).
import { useState } from 'react';
import { Alert, Linking } from 'react-native';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, Chip, Empty, LoadingCards, Row, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { intlPhone, localPhone, timeAgo } from '@/lib/format';
import { deleteSupportMessage, resolveCampaignRequest, resolveSupportMessage, useCampaignRequests, useInvalidate, useSupportMessages } from '@/lib/queries';
import { space, useColors } from '@/theme';

export default function Inbox() {
  const c = useColors();
  const toast = useToast();
  const { user } = useUser();
  const isSuper = user.role === 'superadmin';
  const [tab, setTab] = useState<'support' | 'requests'>('support');
  const support = useSupportMessages(true);
  const requests = useCampaignRequests(isSuper);
  const invalidate = useInvalidate();

  const act = async (fn: () => Promise<unknown>, key: string, msg: string) => {
    try {
      await fn();
      await invalidate(key);
      toast(msg);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const confirmDelete = (id: string) =>
    Alert.alert('حذف الرسالة', 'هل تريد حذف هذه الرسالة؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => act(() => deleteSupportMessage(id), 'support', 'تم الحذف') },
    ]);

  const q = tab === 'support' ? support : requests;

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={q.refetch}>
      {isSuper && (
        <Row gap={space.sm}>
          <Chip label="رسائل الدعم" active={tab === 'support'} onPress={() => setTab('support')} />
          <Chip label="طلبات تأسيس حملات" active={tab === 'requests'} onPress={() => setTab('requests')} />
        </Row>
      )}

      {q.isLoading ? (
        <LoadingCards count={2} />
      ) : tab === 'support' ? (
        (support.data ?? []).length === 0 ? (
          <Empty icon="inbox" title="لا توجد رسائل" />
        ) : (
          (support.data ?? []).map((m) => (
            <Card key={m.id} style={{ gap: space.sm, opacity: m.resolved ? 0.65 : 1 }}>
              <Row>
                <T v="heading" style={{ flex: 1 }}>
                  {m.from_user}
                </T>
                {m.resolved ? <Badge label="تمت المعالجة" tone="success" /> : null}
                <T v="caption" color={c.muted}>
                  {timeAgo(m.created_at)}
                </T>
              </Row>
              {m.subject ? <T v="label">{m.subject}</T> : null}
              <T selectable>{m.body}</T>
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                {m.phone ? <Button small kind="soft" icon="message-circle" title={localPhone(m.phone)} onPress={() => Linking.openURL(`https://wa.me/${intlPhone(m.phone)}`)} /> : null}
                {!m.resolved && <Button small kind="soft" icon="check" title="تمت المعالجة" onPress={() => act(() => resolveSupportMessage(m.id), 'support', 'تم')} />}
                <Button small kind="ghost" icon="trash-2" title="حذف" tint={c.danger} onPress={() => confirmDelete(m.id)} />
              </Row>
            </Card>
          ))
        )
      ) : (requests.data ?? []).length === 0 ? (
        <Empty icon="flag" title="لا توجد طلبات" />
      ) : (
        (requests.data ?? []).map((r) => (
          <Card key={r.id} style={{ gap: space.sm, opacity: r.resolved ? 0.65 : 1 }}>
            <Row>
              <T v="heading" style={{ flex: 1 }}>
                {r.payload.name}
              </T>
              {r.resolved ? <Badge label="تمت المعالجة" tone="success" /> : null}
              <T v="caption" color={c.muted}>
                {timeAgo(r.created_at)}
              </T>
            </Row>
            {r.payload.message ? <T selectable>{r.payload.message}</T> : null}
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Button small kind="soft" icon="message-circle" title={localPhone(r.payload.phone) || r.payload.phone} onPress={() => Linking.openURL(`https://wa.me/${intlPhone(r.payload.phone)}`)} />
              {!r.resolved && <Button small kind="soft" icon="check" title="تمت المعالجة" onPress={() => act(() => resolveCampaignRequest(r.id), 'campaignRequests', 'تم')} />}
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
