// Admin notice card shown only on the profile tab. Image-sized, optional hidden link, Cancel / OK.
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Image } from '../../components/CachedImage';
import { myNotice, noticeDone } from '../../lib/admin';

type N = { id: string; image_url: string; link: string | null };

export function NoticeCard() {
  const [n, setN] = useState<N | null>(null);
  const [ratio, setRatio] = useState(1);
  useEffect(() => { void myNotice().then(setN).catch(() => undefined); }, []);
  if (!n) return null;
  const close = () => { void noticeDone(n.id).catch(() => undefined); setN(null); };
  const open = () => { if (n.link) void Linking.openURL(n.link); };
  return (
    <View style={{ alignItems: 'center', marginVertical: 10 }}>
      <View style={{ width: '82%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#0D0D0F' }}>
        <Pressable disabled={!n.link} onPress={open}>
          <Image source={{ uri: n.image_url }} style={{ width: '100%', aspectRatio: ratio }} resizeMode="cover"
            onLoad={(e: any) => { const w = e?.source?.width, h = e?.source?.height; if (w && h) setRatio(w / h); }} />
        </Pressable>
        {!!n.link && (
          <View style={{ flexDirection: 'row' }}>
            <Pressable onPress={close} style={{ flex: 1, padding: 10, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text></Pressable>
            <Pressable onPress={() => { open(); close(); }} style={{ flex: 1, padding: 10, alignItems: 'center', backgroundColor: '#FFA500' }}><Text style={{ color: '#000', fontWeight: '800' }}>OK</Text></Pressable>
          </View>
        )}
        {!n.link && <Pressable onPress={close} style={{ padding: 10, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text></Pressable>}
      </View>
    </View>
  );
}
