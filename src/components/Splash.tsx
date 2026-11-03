// Full-screen mobile splash: fades in, 3s filling progress bar, fades out.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';

const NATIVE = Platform.OS !== 'web';
export const SPLASH_MS = 3000;

export function Splash({ onDone }: { onDone: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  const prog = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 350, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
    Animated.timing(prog, { toValue: 1, duration: SPLASH_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => {
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: NATIVE }).start(onDone);
    });
  }, [fade, prog, onDone]);
  const pct = prog.interpolate({ inputRange: [0, 1], outputRange: [0, w] });
  return (
    <View style={s.root} testID="splash">
      <Animated.View style={[s.inner, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
        <Image source={require('../../assets/logo-b.png')} style={s.logo} resizeMode="contain" />
        <Text style={s.brand}><Text style={{ color: '#FFFFFF' }}>Bee</Text> Took</Text>
        <View style={s.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <Animated.View style={[s.fill, { width: pct }]} testID="splash-progress" />
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 430, alignItems: 'center', paddingHorizontal: 48 },
  logo: { width: 120, height: 120 },
  brand: { color: '#FFA500', fontSize: 30, fontWeight: '900', marginTop: 10, marginBottom: 28 },
  track: { width: '72%', maxWidth: 260, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#FFA500', shadowColor: '#FFA500', shadowOpacity: 0.9, shadowRadius: 8 },
});
