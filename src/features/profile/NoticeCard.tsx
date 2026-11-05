// Admin notice: a blocking full-screen announcement that zooms in. The user must close it (or press the action button) to continue.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from '../../components/CachedImage';
import { myNotice, noticeDone, openLink } from '../../lib/admin';

type N = { id: string; image_url: string; link: string | null };

export function NoticeCard() {
  const [n, setN] = useState<N | null>(null);
  const [ratio, setRatio] = useState(1);
  const { width, height } = useWindowDimensions();
  const zoom = useRef(new Animated.Value(0)).current;
  useEffect(() => { void myNotice().then(setN).catch(() => undefined); }, []);
  useEffect(() => {
    if (n) Animated.timing(zoom, { toValue: 1, duration: 320, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }).start();
  }, [n, zoom]);
  if (!n) return null;
  const close = () => { void noticeDone(n.id).catch(() => undefined); setN(null); };
  const maxW = width * 0.88, maxH = height * 0.68;
  const w = Math.min(maxW, maxH * ratio);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ width: w, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0D0D0F', opacity: zoom, transform: [{ scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
          <Image source={{ uri: n.image_url }} style={{ width: '100%', aspectRatio: ratio }} resizeMode="cover"
            onLoad={(e: any) => { const iw = e?.source?.width, ih = e?.source?.height; if (iw && ih) setRatio(iw / ih); }} />
          <View style={{ flexDirection: 'row' }}>
            <Pressable accessibilityLabel="Cancel" onPress={close} style={{ flex: 1, padding: 14, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text></Pressable>
            {!!n.link && (
              <Pressable accessibilityLabel="Open link" onPress={() => { openLink(n.link); close(); }} style={{ flex: 1, padding: 14, alignItems: 'center', backgroundColor: '#FFA500' }}>
                <Text style={{ color: '#000', fontWeight: '800' }}>Open</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
