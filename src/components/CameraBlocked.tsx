// Permission prompt: "Allow" while the OS can still ask, otherwise "Open Settings". Never mounts the camera.
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import type { PermissionResponse } from 'expo-camera';
import { colors } from '../theme';

export function CameraBlocked({ perm, ask }: { perm: PermissionResponse | null; ask: () => Promise<PermissionResponse> }) {
  const settings = !!perm && !perm.granted && !perm.canAskAgain;
  return (
    <Pressable style={s.btn} onPress={() => (settings ? void Linking.openSettings() : void ask().catch(() => undefined))}>
      <Text style={s.t}>{settings ? 'Open Settings' : 'Allow camera'}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 22, paddingVertical: 11 },
  t: { color: '#000', fontWeight: '900' },
});
