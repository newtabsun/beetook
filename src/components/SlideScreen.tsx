// Full-screen panel that slides in from the right.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

export function SlideScreen({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(width)).current;
  useEffect(() => { Animated.timing(x, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [x]);
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', transform: [{ translateX: x }] }]}>{children}</Animated.View>;
}
