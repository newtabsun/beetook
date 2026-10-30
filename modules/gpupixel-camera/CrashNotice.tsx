// Shows the camera crash report from the previous run once, with a Copy button (Android only).
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Clipboard from 'expo-clipboard';

const Mod = Platform.OS === 'android' ? requireOptionalNativeModule<{ takeCrashReport(): string | null }>('GpuPixelCamera') : null;

export function CrashNotice() {
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { try { setText(Mod?.takeCrashReport() ?? null); } catch { setText(null); } }, []);
  if (!text) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => setText(null)}>
      <View style={s.back}>
        <View style={s.card}>
          <Text style={s.h}>ካሜራው ባለፈው ጊዜ ተዘግቷል</Text>
          <ScrollView style={s.box}><Text selectable style={s.mono}>{text}</Text></ScrollView>
          <View style={s.row}>
            <Pressable style={s.btn} onPress={() => { void Clipboard.setStringAsync(text).then(() => setCopied(true)); }}>
              <Text style={s.bt}>{copied ? 'ተገልብጧል ✓' : 'Copy'}</Text>
            </Pressable>
            <Pressable style={[s.btn, s.ghost]} onPress={() => setText(null)}><Text style={s.gt}>ዝጋ</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#161616', borderRadius: 16, padding: 16 },
  h: { color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 10 },
  box: { maxHeight: 280, backgroundColor: '#000', borderRadius: 8, padding: 8 },
  mono: { color: '#ddd', fontSize: 11, fontFamily: Platform.OS === 'android' ? 'monospace' : undefined },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, backgroundColor: '#FFA500', borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  bt: { color: '#000', fontWeight: '900' },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#555' },
  gt: { color: '#fff', fontWeight: '700' },
});
