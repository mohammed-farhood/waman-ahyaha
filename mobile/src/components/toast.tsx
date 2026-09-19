// Lightweight toasts (success / error / info) with an optional action such as "تراجع" (undo).
import * as Haptics from 'expo-haptics';
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, radius, space, useColors } from '@/theme';
import { Icon, IconName } from './ui';

type Kind = 'success' | 'error' | 'info';
type ToastOpts = { duration?: number; action?: { label: string; onPress: () => void } };
type ToastItem = { id: number; msg: string; kind: Kind } & ToastOpts;

const Ctx = createContext<(msg: string, kind?: Kind, opts?: ToastOpts) => void>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const show = useCallback((msg: string, kind: Kind = 'success', opts: ToastOpts = {}) => {
    if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setItem({ id: ++seq.current, msg, kind, ...opts });
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {item && <ToastView key={item.id} item={item} onDone={() => setItem((cur) => (cur?.id === item.id ? null : cur))} />}
    </Ctx.Provider>
  );
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(onDone);
    }, item.duration ?? (item.action ? 5000 : 3000));
    return () => clearTimeout(t);
  }, [anim, item, onDone]);
  const tone: Record<Kind, [string, IconName]> = {
    success: [c.success, 'check-circle'],
    error: [c.danger, 'alert-circle'],
    info: [c.primary, 'info'],
  };
  const [color, icon] = tone[item.kind];
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.wrap,
        { top: insets.top + space.sm, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
      ]}>
      <Pressable accessibilityHint="اضغط للإغلاق" onPress={onDone} style={[styles.toast, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Icon name={icon} size={20} color={color} />
        <Text style={[styles.msg, { color: c.heading }]}>{item.msg}</Text>
        {item.action && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              item.action?.onPress();
              onDone();
            }}>
            <Text style={[styles.action, { color: c.primary }]}>{item.action.label}</Text>
          </Pressable>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  msg: { flex: 1, fontFamily: font.semibold, fontSize: 14, lineHeight: 22 },
  action: { fontFamily: font.bold, fontSize: 14 },
});
