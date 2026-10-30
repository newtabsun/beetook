// Original vector emblem for a gift: a tier-specific frame (plain ring → starburst → gem hexagon → crowned laurel burst)
// drawn with react-native-svg, with the gift's emoji glyph in the middle. Same component everywhere gifts are shown.
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';
import { TIERS, type GiftTier } from '../lib/gifts';

const pt = (r: number, a: number) => `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
const star = (n: number, ro: number, ri: number) =>
  Array.from({ length: n * 2 }, (_, i) => pt(i % 2 ? ri : ro, -Math.PI / 2 + (i * Math.PI) / n)).join(' ');
const ring = (n: number, r: number, off = 0) => Array.from({ length: n }, (_, i) => {
  const a = off - Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
});

export function GiftEmblem({ gift, size = 48 }: { gift: { emoji: string; tier: GiftTier }; size?: number }) {
  const tier = gift.tier;
  const t = TIERS[tier];
  const grad = `url(#gr${tier})`;
  const gems = tier === 4 ? ring(6, 41) : tier === 5 ? ring(8, 43) : tier === 2 ? ring(4, 44, Math.PI / 4) : [];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`gb${tier}`} cx="50%" cy="38%" r="70%">
            <Stop offset="0" stopColor={t.c2} stopOpacity="0.55" />
            <Stop offset="1" stopColor={t.dark} stopOpacity="1" />
          </RadialGradient>
          <LinearGradient id={`gr${tier}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.c1} />
            <Stop offset="1" stopColor={t.c2} />
          </LinearGradient>
        </Defs>
        {tier >= 3 && <Polygon points={star(tier === 3 ? 8 : tier === 4 ? 12 : 16, 49, tier === 5 ? 40 : 38)} fill={grad} opacity={0.9} />}
        {tier === 4 ? (
          <Polygon points={Array.from({ length: 6 }, (_, i) => pt(40, -Math.PI / 2 + (i * Math.PI) / 3)).join(' ')} fill={`url(#gb${tier})`} stroke={grad} strokeWidth={4} />
        ) : (
          <Circle cx={50} cy={50} r={tier >= 3 ? 36 : 43} fill={`url(#gb${tier})`} stroke={grad} strokeWidth={tier === 1 ? 3 : 4} />
        )}
        {tier === 2 && <Circle cx={50} cy={50} r={37} fill="none" stroke={t.c1} strokeWidth={1.5} opacity={0.7} />}
        {tier === 5 && <Circle cx={50} cy={50} r={46} fill="none" stroke={grad} strokeWidth={2.5} />}
        {gems.map((g, i) => <Circle key={i} cx={g.x} cy={g.y} r={tier === 5 ? 3.4 : 3} fill={i % 2 ? t.c2 : '#FFFFFF'} stroke={t.c1} strokeWidth={1} />)}
        {tier === 5 && <Path d="M36 14 L42 24 L50 8 L58 24 L64 14 L62 28 L38 28 Z" fill={grad} stroke="#FFFFFF" strokeWidth={0.8} />}
      </Svg>
      <Text style={{ fontSize: size * (tier >= 3 ? 0.4 : 0.5), textAlign: 'center' }} allowFontScaling={false}>{gift.emoji}</Text>
    </View>
  );
}
