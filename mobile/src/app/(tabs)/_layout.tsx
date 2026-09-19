import Feather from '@expo/vector-icons/Feather';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { font, useColors } from '@/theme';

type TabIcon = keyof typeof Feather.glyphMap;
const icon = (name: TabIcon) =>
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color as string} size={size - 2} />;
  };

export default function TabsLayout() {
  const c = useColors();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.subtle,
        // Cairo has tall glyphs: give the bar explicit room (plus the home-indicator inset) so labels aren't clipped
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 64 + insets.bottom, paddingTop: 2, paddingBottom: insets.bottom + 2 },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11, lineHeight: 18 },
      }}>
      <Tabs.Screen name="home" options={{ title: 'الرئيسية', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="grid" options={{ title: 'التبرعات', tabBarIcon: icon('grid') }} />
      <Tabs.Screen name="news" options={{ title: 'الأخبار', tabBarIcon: icon('bell') }} />
      <Tabs.Screen name="collectors" options={{ title: 'المسؤولون', tabBarIcon: icon('users') }} />
      <Tabs.Screen name="profile" options={{ title: 'حسابي', tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
