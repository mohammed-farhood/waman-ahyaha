// Design tokens — mirrors the web app's css/main.css palette so both clients feel like one product.
import { useColorScheme } from 'react-native';

const light = {
  primary: '#2A8FA0',
  primaryDark: '#1D6B79',
  primaryDarker: '#145563',
  primaryBg: '#EBF6F9',
  gold: '#C8A92A',
  goldLight: '#E8CA50',
  goldBg: '#FDF8EA',
  onGold: '#5C4300',
  heroFrom: '#236472',
  heroTo: '#1A4D5A',

  bg: '#F4F7F9',
  surface: '#FFFFFF',
  surface2: '#F8FAFC',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  heading: '#0F172A',
  text: '#334155',
  muted: '#64748B',
  subtle: '#94A3B8',
  onPrimary: '#FFFFFF',

  success: '#16A34A',
  successBg: '#DCFCE7',
  danger: '#DC2626',
  dangerBg: '#FEE2E2',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  info: '#2563EB',
  infoBg: '#DBEAFE',
  overlay: 'rgba(15,23,42,0.45)',
};

export type Palette = typeof light;

const dark: Palette = {
  ...light,
  primary: '#3AAFC3',
  primaryBg: '#12343B',
  goldBg: '#2E2710',
  onGold: '#1F1600',
  heroFrom: '#16404A',
  heroTo: '#0F2A31',

  bg: '#0B1417',
  surface: '#132126',
  surface2: '#18292F',
  border: '#22363D',
  borderStrong: '#2F4A52',

  heading: '#F1F5F9',
  text: '#D5DEE6',
  muted: '#94A3B8',
  subtle: '#64748B',

  successBg: '#0F2E1C',
  dangerBg: '#3A1212',
  warningBg: '#35240A',
  infoBg: '#10213F',
  overlay: 'rgba(0,0,0,0.6)',
};

export const palettes = { light, dark };

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark() {
  return useColorScheme() === 'dark';
}

export const font = {
  regular: 'Cairo_400Regular',
  semibold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
  black: 'Cairo_800ExtraBold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
} as const;
