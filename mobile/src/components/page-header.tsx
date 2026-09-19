// Title row for the tab screens. The superadmin also gets a campaign switcher here.
import { ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useActiveGroup } from '@/lib/queries';
import { radius, space, useColors } from '@/theme';
import { Icon, Row, Sheet, T } from './ui';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const c = useColors();
  const { user, setGroupId } = useAuth();
  const { id, group, groups } = useActiveGroup();
  const [open, setOpen] = useState(false);
  const isSuper = user?.role === 'superadmin';

  return (
    <View style={{ gap: 2 }}>
      <Row>
        <T v="title" style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </T>
        {action}
      </Row>
      {isSuper ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تغيير الحملة"
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
          <Row gap={4}>
            <Icon name="layers" size={14} color={c.primary} />
            <T v="label" color={c.primary}>
              {group?.name ?? 'اختر الحملة'}
            </T>
            <Icon name="chevron-down" size={14} color={c.primary} />
          </Row>
        </Pressable>
      ) : subtitle ? (
        <T v="label" color={c.muted}>
          {subtitle}
        </T>
      ) : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title="اختر الحملة">
        {groups.map((g) => (
          <Pressable
            key={g.id}
            accessibilityRole="button"
            onPress={() => {
              setGroupId(g.id);
              setOpen(false);
            }}
            style={({ pressed }) => ({
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: g.id === id ? c.primary : c.border,
              backgroundColor: g.id === id ? c.primaryBg : pressed ? c.surface2 : c.surface,
            })}>
            <Row>
              <View style={{ flex: 1 }}>
                <T v="heading">{g.name}</T>
                <T v="caption" color={c.muted}>
                  {[g.university, `${g.donor_count} متبرع`].filter(Boolean).join(' · ')}
                </T>
              </View>
              {g.id === id && <Icon name="check" color={c.primary} />}
            </Row>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}
