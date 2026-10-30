// Small round notification badge. Hidden at 0; shows "99+" above 99.
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  if (!(count > 0)) return null;
  return (
    <View accessibilityLabel={`${badgeText(count)} unread`} style={[s.badge, style]}>
      <Text style={s.t}>{badgeText(count)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  t: { color: '#fff', fontSize: 10, fontWeight: '900', lineHeight: 12 },
});
