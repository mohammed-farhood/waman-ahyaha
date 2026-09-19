import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/cairo';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, I18nManager, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/toast';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { font, palettes, useIsDark } from '@/theme';

// Arabic-only app: RTL is forced natively (expo-localization plugin); this covers Expo Go / dev builds.
if (Platform.OS === 'web') {
  // web previews only: the browser needs dir="rtl" (I18nManager is native-only)
  if (typeof document !== 'undefined') document.documentElement.dir = 'rtl';
} else if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Refetch stale data when the app comes back to the foreground (the web app does the same on visibilitychange).
AppState.addEventListener('change', (s) => {
  if (Platform.OS !== 'web') focusManager.setFocused(s === 'active');
});

function RootStack() {
  const { ready, user } = useAuth();
  const dark = useIsDark();
  const c = dark ? palettes.dark : palettes.light;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.surface, text: c.heading, border: c.border } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontFamily: font.bold, fontSize: 17 },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.primary,
          contentStyle: { backgroundColor: c.bg },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* guests only — disappear the moment someone signs in */}
        <Stack.Protected guard={!user}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'تسجيل الدخول' }} />
          <Stack.Screen name="register" options={{ title: 'انضم كمتبرع' }} />
        </Stack.Protected>
        {/* signed-in only — removed automatically on logout, account deletion or an expired session */}
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="orphans" options={{ title: 'الأيتام المكفولون' }} />
          <Stack.Screen name="leaderboard" options={{ title: 'ترتيب الحملات' }} />
          <Stack.Screen name="inbox" options={{ title: 'الرسائل' }} />
          <Stack.Screen name="telegram" options={{ title: 'ربط التليجرام' }} />
          <Stack.Screen name="bot-settings" options={{ title: 'بوت التليجرام' }} />
          <Stack.Screen name="delete-account" options={{ title: 'حذف الحساب', presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Screen name="start-campaign" options={{ title: 'ابدأ حملة جديدة' }} />
        <Stack.Screen name="about" options={{ title: 'عن المنصة' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <RootStack />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
