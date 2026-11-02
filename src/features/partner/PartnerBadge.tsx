// Level pill L1…L5: a different color per level and a size that grows with the level.
import { StyleSheet, Text, View } from 'react-native';
import { levelInfo } from '../../lib/partner';

export function PartnerBadge({ level, scale = 1 }: { level: number; scale?: number }) {
  const info = levelInfo(level);
  const k = (0.9 + 0.12 * (info.level - 1)) * scale;
  return (
    <View accessibilityLabel={`Partner level L${info.level}`}
      style={[s.pill, { borderColor: info.color, backgroundColor: `${info.color}26`, paddingHorizontal: 9 * k, paddingVertical: 3 * k, borderRadius: 99 }]}>
      <Text style={{ color: info.color, fontWeight: '900', fontSize: 11 * k, letterSpacing: 0.5 }}>L{info.level}</Text>
    </View>
  );
}

const s = StyleSheet.create({ pill: { borderWidth: 1.5, alignSelf: 'flex-start' } });
