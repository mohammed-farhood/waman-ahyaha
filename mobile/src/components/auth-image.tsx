// Announcement images are served behind auth, so the request must carry the Bearer token.
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { API_URL, getAccessToken, refreshSession } from '@/lib/api';
import { radius, useColors } from '@/theme';
import { Icon } from './ui';

export function AuthImage({ path, style }: { path: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const token = getAccessToken();
  if (failed) {
    return (
      <View style={[{ height: 120, borderRadius: radius.md, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Icon name="image" color={c.subtle} />
      </View>
    );
  }
  return (
    <Image
      key={attempt}
      source={{ uri: API_URL + path, headers: { 'X-Client': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }}
      style={[{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: c.surface2 }, style as object]}
      contentFit="cover"
      transition={200}
      cachePolicy="disk"
      accessibilityLabel="صورة الإعلان"
      onError={async () => {
        // most likely an expired access token: refresh once and retry
        if (attempt === 0 && (await refreshSession())) setAttempt(1);
        else setFailed(true);
      }}
    />
  );
}
