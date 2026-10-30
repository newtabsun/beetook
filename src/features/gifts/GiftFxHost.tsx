// Full-screen gift animation. One host (mounted once in App) plays a queue of gifts sent from ANY screen via playGift().
// Everything runs on a single Animated.Value driven natively; richness grows with the gift tier (1 basic … 5 legendary).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Polygon, RadialGradient, Stop, Circle } from 'react-native-svg';
import { GiftEmblem } from '../../components/GiftEmblem';
import { TIERS, formatCoins, type GiftTier } from '../../lib/gifts';
import { onGiftPlay, type GiftPlay } from '../../lib/giftFx';

type Play = GiftPlay & { id: number };
const DURATION: Record<GiftTier, number> = { 1: 1800, 2: 2500, 3: 3400, 4: 4400, 5: 5600 };
const PARTICLES: Record<GiftTier, number> = { 1: 8, 2: 14, 3: 22, 4: 30, 5: 40 };
const GLYPHS: Record<GiftTier, string[]> = { 1: ['✦', '·'], 2: ['✨', '★'], 3: ['✨', '💫', '★'], 4: ['✨', '💫', '❖', '★'], 5: ['✨', '💫', '👑', '★', '❖'] };
const EMBLEM: Record<GiftTier, number> = { 1: 120, 2: 150, 3: 180, 4: 210, 5: 240 };
const DIM: Record<GiftTier, number> = { 1: 0.12, 2: 0.3, 3: 0.55, 4: 0.72, 5: 0.86 };
const MAX_QUEUE = 10;

interface Spec { dx: number; dy: number; start: number; size: number; glyph: string }
function makeParticles(tier: GiftTier, seed: number): Spec[] {
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: PARTICLES[tier] }, () => {
    const a = rnd() * Math.PI * 2;
    const dist = 90 + rnd() * (120 + tier * 30);
    return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist + (tier >= 3 ? rnd() * 70 : 0), start: 0.08 + rnd() * 0.32, size: 10 + rnd() * 16, glyph: GLYPHS[tier][Math.floor(rnd() * GLYPHS[tier].length)] };
  });
}

function Particle({ p, spec, color }: { p: Animated.Value; spec: Spec; color: string }) {
  const { start: s } = spec; const e = s + 0.36;
  return (
    <Animated.Text allowFontScaling={false} style={{
      position: 'absolute', fontSize: spec.size, color,
      opacity: p.interpolate({ inputRange: [0, s, s + 0.06, e, 1], outputRange: [0, 0, 1, 0, 0] }),
      transform: [
        { translateX: p.interpolate({ inputRange: [0, s, e, 1], outputRange: [0, 0, spec.dx, spec.dx] }) },
        { translateY: p.interpolate({ inputRange: [0, s, e, 1], outputRange: [0, 0, spec.dy, spec.dy] }) },
        { scale: p.interpolate({ inputRange: [s, e], outputRange: [0.4, 1.3], extrapolate: 'clamp' }) },
      ],
    }}>{spec.glyph}</Animated.Text>
  );
}

function Rays({ p, tier }: { p: Animated.Value; tier: GiftTier }) {
  const t = TIERS[tier];
  const wedges = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const a1 = (i * Math.PI * 2) / 12; const a2 = a1 + Math.PI / 18; const r = 260;
    return `260,260 ${260 + r * Math.cos(a1)},${260 + r * Math.sin(a1)} ${260 + r * Math.cos(a2)},${260 + r * Math.sin(a2)}`;
  }), []);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', width: 520, height: 520,
      opacity: p.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 0.8, 0.8, 0] }),
      transform: [{ rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', tier === 5 ? '200deg' : '120deg'] }) }] }}>
      <Svg width={520} height={520} viewBox="0 0 520 520">
        <Defs><RadialGradient id="rayg" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={t.c1} stopOpacity="0.55" /><Stop offset="1" stopColor={t.c1} stopOpacity="0" /></RadialGradient></Defs>
        {wedges.map((pts, i) => <Polygon key={i} points={pts} fill="url(#rayg)" />)}
      </Svg>
    </Animated.View>
  );
}

function GiftPlayer({ play, speed, onEnd }: { play: Play; speed: number; onEnd: () => void }) {
  const tier = play.gift.tier; const t = TIERS[tier]; const size = EMBLEM[tier];
  const p = useRef(new Animated.Value(0)).current;
  const ended = useRef(false);
  const finish = useCallback(() => { if (!ended.current) { ended.current = true; onEnd(); } }, [onEnd]);
  const specs = useMemo(() => makeParticles(tier, play.id), [tier, play.id]);
  useEffect(() => {
    const anim = Animated.timing(p, { toValue: 1, duration: DURATION[tier] * speed, easing: Easing.linear, useNativeDriver: true });
    anim.start(() => finish());
    return () => anim.stop();
  }, [p, tier, speed, finish]);
  const skip = () => { p.stopAnimation(); finish(); };
  const shake = tier >= 4;
  return (
    <Pressable accessibilityLabel="Skip gift animation" disabled={tier < 3} onPress={skip} style={fx.root} pointerEvents={tier < 3 ? 'none' : 'auto'}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.dark, opacity: p.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, DIM[tier], DIM[tier], 0] }) }]} />
      {tier === 5 && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: p.interpolate({ inputRange: [0, 0.05, 0.2, 1], outputRange: [0, 0.9, 0, 0] }) }]} />}
      {tier >= 4 && <Rays p={p} tier={tier} />}
      {[0, 1, 2].slice(0, tier >= 3 ? 3 : tier).map((k) => {
        const s = 0.05 + k * 0.1;
        return <Animated.View key={k} pointerEvents="none" style={{ position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 3, borderColor: t.c1,
          opacity: p.interpolate({ inputRange: [0, s, s + 0.45], outputRange: [0, 0.9, 0] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, s, s + 0.45], outputRange: [0.4, 0.4, 3.4] }) }] }} />;
      })}
      <Animated.View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center',
        opacity: p.interpolate({ inputRange: [0, 0.06, 0.88, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: p.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [60, 0, -6, -40] }) },
          { scale: p.interpolate({ inputRange: [0, 0.12, 0.2, 0.75, 0.9, 1], outputRange: [0.1, 1.35, 1, 1.08, 1.15, 0.3] }) },
          { rotate: shake ? p.interpolate({ inputRange: [0, 0.12, 0.16, 0.2, 0.24, 0.28, 1], outputRange: ['0deg', '-8deg', '8deg', '-5deg', '5deg', '0deg', '0deg'] }) : '0deg' },
        ] }}>
        <Svg width={size * 2.2} height={size * 2.2} style={{ position: 'absolute' }}>
          <Defs><RadialGradient id="glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={t.c1} stopOpacity="0.75" /><Stop offset="1" stopColor={t.c2} stopOpacity="0" /></RadialGradient></Defs>
          <Circle cx={size * 1.1} cy={size * 1.1} r={size * 1.1} fill="url(#glow)" />
        </Svg>
        <GiftEmblem gift={play.gift} size={size} />
      </Animated.View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={fx.center}>{specs.map((sp, i) => <Particle key={i} p={p} spec={sp} color={i % 2 ? t.c1 : '#FFFFFF'} />)}</View>
      </View>
      <Animated.View pointerEvents="none" style={[fx.text, {
        opacity: p.interpolate({ inputRange: [0, 0.18, 0.3, 0.82, 0.95], outputRange: [0, 0, 1, 1, 0] }),
        transform: [{ translateY: p.interpolate({ inputRange: [0.18, 0.35], outputRange: [20, 0], extrapolate: 'clamp' }) }] }]}>
        <Text numberOfLines={1} style={fx.from}>{play.from}{play.to ? `  →  ${play.to}` : ''}</Text>
        <Text style={[fx.name, { color: t.c1 }]}>{play.gift.name}{play.qty > 1 ? `  ×${play.qty}` : ''}</Text>
        <Text style={fx.coins}>🪙 {formatCoins(play.gift.coins * play.qty)}</Text>
      </Animated.View>
      {tier >= 3 && <Text pointerEvents="none" style={fx.hint}>Tap to skip</Text>}
    </Pressable>
  );
}

export function GiftFxHost() {
  const queue = useRef<GiftPlay[]>([]);
  const busy = useRef(false);
  const seq = useRef(0);
  const [cur, setCur] = useState<Play | null>(null);
  const [speed, setSpeed] = useState(1);
  const next = useCallback(() => {
    const n = queue.current.shift();
    if (!n) { busy.current = false; setCur(null); return; }
    busy.current = true;
    setSpeed(queue.current.length > 3 ? 0.55 : queue.current.length > 1 ? 0.8 : 1);
    setCur({ ...n, id: ++seq.current });
  }, []);
  useEffect(() => onGiftPlay((p) => {
    if (queue.current.length >= MAX_QUEUE) queue.current.shift();
    queue.current.push(p);
    if (!busy.current) next();
  }), [next]);
  if (!cur) return null;
  return <GiftPlayer key={cur.id} play={cur} speed={speed} onEnd={next} />;
}

const fx = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { position: 'absolute', bottom: '22%', alignItems: 'center', paddingHorizontal: 24, gap: 2 },
  from: { color: '#fff', fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
  name: { fontSize: 28, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 8 },
  coins: { color: '#FFD700', fontSize: 16, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 6 },
  hint: { position: 'absolute', bottom: 24, color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700' },
});
