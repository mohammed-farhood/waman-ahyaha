import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Avatar } from '@/components/brand';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, Field, IconButton, LoadingCards, Row, Screen, Sheet, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { birthdayInfo, fmt, money } from '@/lib/format';
import { OrphanInput, createOrphan, deleteOrphan, updateOrphan, useActiveGroup, useInvalidate, useOrphans } from '@/lib/queries';
import { Orphan, isManager } from '@/lib/types';
import { space, useColors } from '@/theme';

export default function Orphans() {
  const c = useColors();
  const toast = useToast();
  const { user } = useUser();
  const { id: groupId, group } = useActiveGroup();
  const q = useOrphans(groupId);
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Orphan | 'new' | null>(null);
  const manager = isManager(user.role);
  const list = q.data ?? [];

  const remove = (o: Orphan) =>
    Alert.alert('حذف اليتيم', `هل تريد حذف ${o.name} من قائمة الحملة؟`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOrphan(o.id);
            await invalidate('orphans');
            toast('تم الحذف');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        },
      },
    ]);

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen
        options={{
          title: 'الأيتام المكفولون',
          headerRight: manager ? () => <IconButton name="plus" label="إضافة يتيم" onPress={() => setEditing('new')} /> : undefined,
        }}
      />
      {group ? (
        <T color={c.muted}>
          {group.name} · {fmt(list.length)} يتيم
        </T>
      ) : null}
      {q.isLoading ? (
        <LoadingCards count={3} />
      ) : list.length === 0 ? (
        <Empty
          icon="heart"
          title="لم يُضف أيتام بعد"
          body={manager ? 'أضف الأيتام الذين تكفلهم الحملة ليراهم المتبرعون' : 'سيظهر هنا الأيتام الذين تكفلهم حملتك'}
          action={manager ? <Button small title="إضافة يتيم" icon="plus" onPress={() => setEditing('new')} /> : undefined}
        />
      ) : (
        list.map((o) => {
          const b = birthdayInfo(o.birth_date);
          return (
            <Card key={o.id} style={{ gap: space.sm }}>
              <Row gap={space.md}>
                <Avatar name={o.name} tone="gold" />
                <View style={{ flex: 1 }}>
                  <T v="heading">{o.name}</T>
                  <T v="caption" color={c.muted}>
                    {[b ? `${fmt(b.age)} سنة` : null, o.province, o.code].filter(Boolean).join(' · ')}
                  </T>
                </View>
                {manager && (
                  <>
                    <IconButton name="edit-2" label="تعديل" size={18} onPress={() => setEditing(o)} />
                    <IconButton name="trash-2" label="حذف" size={18} color={c.danger} onPress={() => remove(o)} />
                  </>
                )}
              </Row>
              <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                {o.type ? <Badge label={o.type} /> : null}
                {o.amount ? <Badge label={money(o.amount)} tone="gold" /> : null}
                {b ? <Badge label={b.days === 0 ? 'عيد ميلاده اليوم' : `عيد ميلاده بعد ${fmt(b.days)} يوم`} tone={b.days <= 7 ? 'success' : 'muted'} icon="gift" /> : null}
              </Row>
            </Card>
          );
        })
      )}
      {editing && groupId && <OrphanSheet item={editing === 'new' ? null : editing} groupId={groupId} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function OrphanSheet({ item, groupId, onClose }: { item: Orphan | null; groupId: string; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState(item?.name ?? '');
  const [code, setCode] = useState(item?.code ?? '');
  const [province, setProvince] = useState(item?.province ?? '');
  const [type, setType] = useState(item?.type ?? 'اعتيادية');
  const [amount, setAmount] = useState(String(item?.amount ?? 95000));
  const [birth, setBirth] = useState(item?.birth_date?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'اكتب اسم اليتيم';
    if (!code.trim()) e.code = 'اكتب رمز اليتيم';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || isNaN(Date.parse(birth))) e.birth = 'اكتب التاريخ بصيغة سنة-شهر-يوم، مثل 2015-03-21';
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: OrphanInput = {
      name: name.trim(),
      code: code.trim(),
      province: province.trim(),
      type: type.trim(),
      amount: parseInt(amount.replace(/\D/g, ''), 10) || undefined,
      birthDate: birth,
    };
    setBusy(true);
    try {
      if (item) await updateOrphan(item.id, body);
      else await createOrphan(groupId, body);
      await invalidate('orphans');
      toast(item ? 'تم حفظ التعديل' : 'تمت إضافة اليتيم');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={item ? 'تعديل بيانات اليتيم' : 'إضافة يتيم'}>
      <Field label="الاسم" value={name} onChangeText={setName} error={errors.name} maxLength={200} />
      <Field label="الرمز" value={code} onChangeText={setCode} error={errors.code} placeholder="AAA00000-0" autoCapitalize="characters" maxLength={40} />
      <Field label="تاريخ الميلاد" value={birth} onChangeText={setBirth} error={errors.birth} placeholder="2015-03-21" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Field label="المحافظة" value={province} onChangeText={setProvince} maxLength={60} />
      <Field label="نوع الكفالة" value={type} onChangeText={setType} maxLength={60} />
      <Field label="مبلغ الكفالة (د.ع)" value={amount} onChangeText={setAmount} keyboardType="number-pad" maxLength={9} />
      <Button title={item ? 'حفظ' : 'إضافة'} icon="check" loading={busy} onPress={submit} />
    </Sheet>
  );
}
