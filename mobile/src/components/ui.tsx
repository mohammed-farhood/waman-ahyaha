// Shared building blocks. The whole app runs RTL (forced natively), so rows flow right-to-left
// automatically; never hard-code textAlign left/right — natural alignment is already correct.
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { ReactNode, forwardRef, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  TextStyle,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, radius, shadow, space, useColors } from '@/theme';

export type IconName = keyof typeof Feather.glyphMap;

export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Feather name={name} size={size} color={color ?? c.text} style={style} />;
}

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'number';
const variantStyle: Record<Variant, TextStyle> = {
  display: { fontFamily: font.black, fontSize: 26, lineHeight: 40 },
  title: { fontFamily: font.bold, fontSize: 20, lineHeight: 32 },
  heading: { fontFamily: font.bold, fontSize: 16, lineHeight: 26 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 24 },
  label: { fontFamily: font.semibold, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 18 },
  number: { fontFamily: font.black, fontSize: 24, lineHeight: 34 },
};

export function T({ v = 'body', color, center, style, ...rest }: TextProps & { v?: Variant; color?: string; center?: boolean }) {
  const c = useColors();
  const base = v === 'body' || v === 'caption' ? c.text : c.heading;
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={1.4}
      style={[variantStyle[v], { color: color ?? base }, center && { textAlign: 'center' }, style]}
    />
  );
}

type BtnKind = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger' | 'soft';
export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  small,
  style,
  haptic = true,
  tint,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  /** Text/icon colour override, e.g. white text on the dark hero. */
  tint?: string;
}) {
  const c = useColors();
  const palette: Record<BtnKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    gold: { bg: c.gold, fg: c.onGold },
    outline: { bg: 'transparent', fg: c.primary, border: c.primary },
    ghost: { bg: 'transparent', fg: c.primary },
    danger: { bg: c.danger, fg: '#FFFFFF' },
    soft: { bg: c.primaryBg, fg: c.primary },
  };
  const p = tint ? { ...palette[kind], fg: tint } : palette[kind];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!off}
      aria-busy={!!loading}
      disabled={off}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: p.bg, borderColor: p.border ?? 'transparent', borderWidth: p.border ? 1.5 : 0 },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        off && { opacity: 0.55 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon && <Icon name={icon} size={small ? 16 : 18} color={p.fg} />}
          <Text maxFontSizeMultiplier={1.3} style={[styles.btnText, small && { fontSize: 13 }, { color: p.fg }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, color, size = 20 }: { name: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: pressed ? c.primaryBg : 'transparent' }]}>
      <Icon name={name} size={size} color={color ?? c.primary} />
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useColors();
  const body = [styles.card, shadow.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  if (!onPress) return <View style={body}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [body, pressed && { opacity: 0.9 }]}>
      {children}
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string | null; hint?: string; icon?: IconName }>(
  function Field({ label, error, hint, icon, style, ...rest }, ref) {
    const c = useColors();
    return (
      <View style={{ gap: 6 }}>
        <T v="label">{label}</T>
        <View style={[styles.inputWrap, { backgroundColor: c.surface, borderColor: error ? c.danger : c.borderStrong }]}>
          {icon && <Icon name={icon} size={18} color={c.muted} />}
          <TextInput
            ref={ref}
            placeholderTextColor={c.subtle}
            {...rest}
            style={[styles.input, { color: c.heading }, style]}
          />
        </View>
        {error ? (
          <T v="caption" color={c.danger}>
            {error}
          </T>
        ) : hint ? (
          <T v="caption" color={c.muted}>
            {hint}
          </T>
        ) : null}
      </View>
    );
  },
);

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  padded = true,
  edges = ['top'],
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom')[];
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const inner = [padded && { padding: space.lg }, { gap: space.lg, paddingBottom: space.xxxl }, contentStyle];
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={inner}
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} /> : undefined}>
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, inner]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Badge({ label, tone = 'primary', icon }: { label: string; tone?: 'primary' | 'gold' | 'success' | 'danger' | 'warning' | 'muted'; icon?: IconName }) {
  const c = useColors();
  const map = {
    primary: [c.primaryBg, c.primary],
    gold: [c.goldBg, c.gold],
    success: [c.successBg, c.success],
    danger: [c.dangerBg, c.danger],
    warning: [c.warningBg, c.warning],
    muted: [c.surface2, c.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} size={12} color={fg} />}
      <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: font.bold, fontSize: 11, color: fg }}>
        {label}
      </Text>
    </View>
  );
}

export function Empty({ icon = 'inbox', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primaryBg }]}>
        <Icon name={icon} size={26} color={c.primary} />
      </View>
      <T v="heading" center>
        {title}
      </T>
      {body ? (
        <T v="body" color={c.muted} center>
          {body}
        </T>
      ) : null}
      {action}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.sectionTitle}>
      <View style={[styles.sectionBar, { backgroundColor: c.primary }]} />
      <T v="heading" style={{ flex: 1 }}>
        {title}
      </T>
      {action}
    </View>
  );
}

export function Row({ children, style, gap = space.sm, ...rest }: ViewProps & { gap?: number }) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      {children}
    </View>
  );
}

export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.border, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: color ?? c.primary }} />
    </View>
  );
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const o = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ height, width, borderRadius: radius.sm, backgroundColor: c.border, opacity: o }, style]} />;
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} style={{ gap: 10 }}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="85%" />
          <Skeleton width="40%" />
        </Card>
      ))}
    </View>
  );
}

/** Bottom sheet built on Modal — used for every form/confirm so the flow feels native on both platforms. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable accessibilityLabel="إغلاق" style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} />
        <View style={{ flex: 1 }} pointerEvents="box-none" />
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space.lg }]}>
          <View style={[styles.grabber, { backgroundColor: c.borderStrong }]} />
          <Row style={{ marginBottom: space.md }}>
            <T v="title" style={{ flex: 1 }} accessibilityRole="header">
              {title}
            </T>
            <IconButton name="x" label="إغلاق" onPress={onClose} color={c.muted} />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.lg }} style={{ maxHeight: 560 }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      aria-selected={!!active}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border }]}>
      <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: font.semibold, fontSize: 13, color: active ? c.onPrimary : c.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 50,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  btnSmall: { minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.sm },
  btnText: { fontFamily: font.bold, fontSize: 15 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 50,
  },
  input: { flex: 1, fontFamily: font.regular, fontSize: 16, paddingVertical: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl, paddingHorizontal: space.lg },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionBar: { width: 4, height: 18, borderRadius: 2 },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingTop: space.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.md },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
});
