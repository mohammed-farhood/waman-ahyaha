import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, Pressable, Switch, View } from 'react-native';

import { AuthImage } from '@/components/auth-image';
import { Avatar } from '@/components/brand';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Chip, Empty, Field, IconButton, LoadingCards, Row, Screen, Sheet, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { createAnnouncement, deleteAnnouncement, updateAnnouncement, useActiveGroup, useAnnouncements, useInvalidate } from '@/lib/queries';
import { Announcement, isManager, isStaff } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

const TYPE_LABEL: Record<string, string> = { news: 'خبر', availability: 'تواجد' };

export default function News() {
  const c = useColors();
  const toast = useToast();
  const { user } = useUser();
  const { id: groupId, group } = useActiveGroup();
  const q = useAnnouncements(groupId);
  const invalidate = useInvalidate();
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);

  const items = (q.data ?? []).filter((a) => a.type !== 'reminder');
  const pinned = items.filter((a) => a.is_pinned);
  const rest = items.filter((a) => !a.is_pinned);
  const canManage = (a: Announcement) => isManager(user.role) || a.author_id === user.id;

  const remove = (a: Announcement) =>
    Alert.alert('حذف الإعلان', 'هل تريد حذف هذا الإعلان نهائياً؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAnnouncement(a.id);
            await invalidate('announcements');
            toast('تم حذف الإعلان');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        },
      },
    ]);

  const renderItem = (a: Announcement) => (
    <Card key={a.id} style={{ gap: space.sm, borderColor: a.is_pinned ? c.gold : c.border }}>
      <Row gap={space.sm}>
        <Avatar name={a.author_name} size={36} />
        <View style={{ flex: 1 }}>
          <T v="label">{a.author_name || 'إدارة الحملة'}</T>
          <T v="caption" color={c.muted}>
            {timeAgo(a.posted_at)}
          </T>
        </View>
        {a.is_pinned && <Badge label="مثبّت" tone="gold" icon="bookmark" />}
        <Badge label={TYPE_LABEL[a.type] ?? 'إعلان'} tone={a.type === 'availability' ? 'success' : 'primary'} />
      </Row>
      {a.title ? <T v="heading">{a.title}</T> : null}
      {a.content ? <T selectable>{a.content}</T> : null}
      {a.image ? <AuthImage path={a.image} /> : null}
      {canManage(a) && (
        <Row style={{ justifyContent: 'flex-end' }} gap={0}>
          <IconButton name="edit-2" label="تعديل" onPress={() => setEditing(a)} size={18} />
          <IconButton name="trash-2" label="حذف" onPress={() => remove(a)} color={c.danger} size={18} />
        </Row>
      )}
    </Card>
  );

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <PageHeader
        title="الأخبار والإعلانات"
        subtitle={group?.name}
        action={isStaff(user.role) ? <IconButton name="edit" label="إعلان جديد" onPress={() => setComposing(true)} /> : undefined}
      />
      {q.isLoading ? (
        <LoadingCards count={3} />
      ) : items.length === 0 ? (
        <Empty
          icon="bell"
          title="لا توجد أخبار بعد"
          body={isStaff(user.role) ? 'شارك أول خبر مع متبرعي الحملة' : 'ستظهر هنا أخبار الحملة وإعلاناتها'}
          action={isStaff(user.role) ? <Button small title="إعلان جديد" icon="edit" onPress={() => setComposing(true)} /> : undefined}
        />
      ) : (
        <>
          {pinned.map(renderItem)}
          {rest.map(renderItem)}
        </>
      )}
      {groupId && <ComposeSheet visible={composing} onClose={() => setComposing(false)} groupId={groupId} />}
      {editing && <EditSheet item={editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function ComposeSheet({ visible, onClose, groupId }: { visible: boolean; onClose: () => void; groupId: string }) {
  const c = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [type, setType] = useState<'news' | 'availability'>('news');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [image, setImage] = useState<{ uri: string; data: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    // same budget as the website: longest side ≤ 1000 px, JPEG quality 0.6
    const resize = (a.width ?? 0) >= (a.height ?? 0) ? { width: Math.min(1000, a.width || 1000) } : { height: Math.min(1000, a.height || 1000) };
    const ctx = ImageManipulator.manipulate(a.uri).resize(resize);
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
    if (out.base64) setImage({ uri: out.uri, data: `data:image/jpeg;base64,${out.base64}` });
  };

  const submit = async () => {
    if (!content.trim() && !image) return toast('الرجاء كتابة المحتوى أو إرفاق صورة', 'error');
    setBusy(true);
    try {
      await createAnnouncement({ groupId, type, title: title.trim(), content: content.trim(), isPinned: pinned, image: image?.data ?? null });
      await invalidate('announcements');
      toast('تم نشر الإعلان');
      setTitle('');
      setContent('');
      setImage(null);
      setPinned(false);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="إعلان جديد">
      <Row gap={space.sm}>
        <Chip label="خبر عام" active={type === 'news'} onPress={() => setType('news')} />
        <Chip label="تحديث تواجد" active={type === 'availability'} onPress={() => setType('availability')} />
      </Row>
      <Field label="العنوان (اختياري)" value={title} onChangeText={setTitle} maxLength={120} />
      <Field label="المحتوى" value={content} onChangeText={setContent} multiline maxLength={2000} style={{ minHeight: 110, textAlignVertical: 'top' }} />
      {image ? (
        <View>
          <Image source={{ uri: image.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md }} />
          <Pressable accessibilityRole="button" accessibilityLabel="إزالة الصورة" onPress={() => setImage(null)} style={{ position: 'absolute', top: 8, left: 8, backgroundColor: c.overlay, borderRadius: 16, padding: 6 }}>
            <T v="caption" color="#FFFFFF">
              إزالة
            </T>
          </Pressable>
        </View>
      ) : (
        <Button kind="soft" icon="image" title="إرفاق صورة" onPress={() => pick().catch(() => toast('تعذّر فتح الصور', 'error'))} />
      )}
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="label">تثبيت الإعلان في الأعلى</T>
        <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: c.primary, false: c.borderStrong }} thumbColor="#FFFFFF" />
      </Row>
      <Button title="نشر" icon="send" loading={busy} onPress={submit} />
    </Sheet>
  );
}

function EditSheet({ item, onClose }: { item: Announcement; onClose: () => void }) {
  const c = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [pinned, setPinned] = useState(item.is_pinned);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!content.trim() && !item.image) return toast('الرجاء كتابة المحتوى', 'error');
    setBusy(true);
    try {
      await updateAnnouncement(item.id, { title: title.trim(), content: content.trim(), isPinned: pinned });
      await invalidate('announcements');
      toast('تم حفظ التعديل');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title="تعديل الإعلان">
      <Field label="العنوان" value={title} onChangeText={setTitle} maxLength={120} />
      <Field label="المحتوى" value={content} onChangeText={setContent} multiline maxLength={2000} style={{ minHeight: 110, textAlignVertical: 'top' }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="label">مثبّت في الأعلى</T>
        <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: c.primary, false: c.borderStrong }} thumbColor="#FFFFFF" />
      </Row>
      <Button title="حفظ" icon="check" loading={busy} onPress={submit} />
    </Sheet>
  );
}
