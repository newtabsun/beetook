// In-app toast host: replaces browser alert()/Alert.alert with a mobile-styled card inside the phone frame.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

type Toast = { id: number; title: string; message?: string };
let push: ((t: Omit<Toast, 'id'>) => void) | null = null;
let seq = 0;

export function showToast(title: string, message?: string) {
  if (push) push({ title, message });
}

type Confirm = { title: string; message?: string; ok: string; cancel: string; destructive?: boolean; resolve: (v: boolean) => void };
let ask: ((c: Confirm) => void) | null = null;

/** In-app confirm card (never window.confirm / Alert.alert). Resolves true when confirmed. */
export function showConfirm(o: { title: string; message?: string; ok?: string; cancel?: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ask) { resolve(false); return; }
    ask({ ok: 'OK', cancel: 'Cancel', ...o, resolve });
  });
}

export function DialogHost() {
  const [items, setItems] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<Confirm | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    push = (t) => setItems((x) => [...x.slice(-2), { ...t, id: ++seq }]);
    ask = setDlg;
    return () => { push = null; ask = null; };
  }, []);
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };
  const confirmCard = dlg && (
    <View style={s.backdrop} testID="app-confirm">
      <View style={s.dlg}>
        <Text style={s.dTitle}>{dlg.title}</Text>
        {!!dlg.message && <Text style={s.dMsg}>{dlg.message}</Text>}
        <View style={s.dRow}>
          <Pressable onPress={() => close(false)} style={[s.dBtn, s.dCancel]}><Text style={s.dCancelT}>{dlg.cancel}</Text></Pressable>
          <Pressable onPress={() => close(true)} style={[s.dBtn, { backgroundColor: dlg.destructive ? '#FF3B30' : '#FFA500' }]}>
            <Text style={[s.dOkT, { color: dlg.destructive ? '#fff' : '#000' }]}>{dlg.ok}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
  useEffect(() => {
    if (!items.length) return;
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    const t = setTimeout(() => setItems((x) => x.slice(1)), 2600);
    return () => clearTimeout(t);
  }, [items, fade]);
  if (!items.length) return confirmCard || null;
  return (<>
    {confirmCard}
    <View pointerEvents="box-none" style={s.wrap}>
      {items.map((t) => (
        <Animated.View key={t.id} style={[s.card, { opacity: fade }]} testID="app-toast">
          <Pressable onPress={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
            <Text style={s.title}>{t.title}</Text>
            {!!t.message && <Text style={s.msg}>{t.message}</Text>}
          </Pressable>
        </Animated.View>
      ))}
    </View>
  </>);
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 9999, gap: 8, alignItems: 'center' },
  card: { width: '100%', maxWidth: 380, backgroundColor: 'rgba(24,24,27,0.96)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: 10, paddingHorizontal: 14, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  title: { color: '#fff', fontWeight: '800', fontSize: 13 },
  msg: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  dlg: { width: '100%', maxWidth: 340, backgroundColor: '#1c1c1e', borderRadius: 18, padding: 18, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  dTitle: { color: '#fff', fontWeight: '900', fontSize: 16, textAlign: 'center' },
  dMsg: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
  dRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  dBtn: { flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dCancel: { backgroundColor: 'rgba(255,255,255,0.1)' },
  dCancelT: { color: '#fff', fontWeight: '800' },
  dOkT: { fontWeight: '900' },
});
