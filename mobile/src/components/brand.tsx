// Brand mark (shield + heart, same drawing as the app icon) and small shared pieces.
import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { font, radius, space, useColors } from '@/theme';
import { T } from './ui';

export function BrandMark({ size = 56, shield = '#FFFFFF' }: { size?: number; shield?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E8CA50" />
          <Stop offset="1" stopColor="#C8A92A" />
        </LinearGradient>
      </Defs>
      <Path d="M50 8 L84 21 V46 C84 69 66 84 50 92 C34 84 16 69 16 46 V21 Z" fill="none" stroke={shield} strokeWidth={6} strokeLinejoin="round" />
      <Path
        d="M50 70 C50 70 30 58 30 44 C30 37 35 32 41.5 32 C45.5 32 48.5 34.5 50 37.5 C51.5 34.5 54.5 32 58.5 32 C65 32 70 37 70 44 C70 58 50 70 50 70 Z"
        fill="url(#g)"
      />
    </Svg>
  );
}

export function Avatar({ name, size = 44, tone }: { name?: string | null; size?: number; tone?: 'primary' | 'gold' }) {
  const c = useColors();
  const bg = tone === 'gold' ? c.goldBg : c.primaryBg;
  const fg = tone === 'gold' ? c.gold : c.primary;
  const letter = (name || '؟').trim().charAt(0);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.bold, fontSize: size * 0.42, color: fg, lineHeight: size * 0.62 }}>{letter}</Text>
    </View>
  );
}

export function StatTile({ value, label, tone = 'primary' }: { value: string; label: string; tone?: 'primary' | 'gold' | 'success' | 'danger' }) {
  const c = useColors();
  const color = { primary: c.primary, gold: c.gold, success: c.success, danger: c.danger }[tone];
  return (
    <View style={{ flex: 1, minWidth: '45%', backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: space.md, gap: 2 }}>
      <T v="number" color={color} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      <T v="caption" color={c.muted}>
        {label}
      </T>
    </View>
  );
}
