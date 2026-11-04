// Shared full-screen page chrome for Profile ☰ menu pages (mirrors web account views).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type TextInputProps } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { AppInput } from '../../components/Input';

export const O = '#FFA500';

export function Page({ title, onBack, children, overlay }: { title: string; onBack: () => void; children: ReactNode; overlay?: ReactNode }) {
  return (
    <View style={u.page}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={u.head}>
          <Pressable accessibilityLabel="Back" onPress={onBack} style={u.back}><Icon name="back" size={20} color="#fff" /></Pressable>
          <Text style={u.h}>{title}</Text>
        </View>
        {children}
      </ScrollView>
      {overlay}
    </View>
  );
}

export function BottomSheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  return (
    <Pressable style={u.bg} onPress={onClose}>
      <Pressable accessibilityLabel={label} style={u.sheet} onPress={() => undefined}>
        <View style={u.grab} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </Pressable>
    </Pressable>
  );
}

export function Group({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 20 }}>
      <View style={u.gh}><Icon name={icon} size={14} color={O} /><Text style={u.ght}>{title}</Text></View>
      <View style={u.gbox}>{children}</View>
    </View>
  );
}

export function Toggle({ on }: { on: boolean }) {
  return <View testID={on ? 'toggle-on' : 'toggle-off'} style={[u.sw, on && { backgroundColor: O }]}><View style={[u.knob, on && { transform: [{ translateX: 16 }] }]} /></View>;
}

export function Row({ icon, label, hint, value, toggle, onPress, danger, last }: {
  icon: IconName; label: string; hint?: string; value?: string; toggle?: boolean; onPress?: () => void; danger?: boolean; last?: boolean;
}) {
  const sw = typeof toggle === 'boolean';
  return (
    <Pressable accessibilityLabel={label} accessibilityRole={sw ? 'switch' : 'button'} accessibilityState={sw ? { checked: toggle } : undefined}
      style={[u.row, !last && u.div]} onPress={onPress}>
      <Icon name={icon} size={16} color={danger ? '#FF3B30' : O} />
      <View style={{ flex: 1 }}>
        <Text style={[u.rowT, danger && { color: '#FF3B30' }]}>{label}</Text>
        {!!hint && <Text style={u.hint}>{hint}</Text>}
      </View>
      {sw ? <Toggle on={toggle!} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!!value && <Text numberOfLines={1} style={[u.hint, { maxWidth: 130 }]}>{value}</Text>}
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>›</Text>
        </View>
      )}
    </Pressable>
  );
}

let failN = 0;
/** Call when an action failed so the pressed button can show the failure state. */
export const reportFail = () => { failN += 1; };

export function Btn({ label, onPress, busy, danger, icon }: { label: string; onPress: () => unknown; busy?: boolean; danger?: boolean; icon?: IconName }) {
  const [run, setRun] = useState(false);
  const [res, setRes] = useState<'ok' | 'fail' | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const press = async () => {
    if (run || busy) return;
    const before = failN; setRes(null); setRun(true);
    let ok = true;
    try { await onPress(); } catch { ok = false; }
    if (failN !== before) ok = false;
    if (!alive.current) return;
    setRun(false); setRes(ok ? 'ok' : 'fail');
    setTimeout(() => { if (alive.current) setRes(null); }, 1800);
  };
  const spin = run || !!busy;
  const fg = danger ? '#fff' : '#000';
  return (
    <Pressable accessibilityLabel={label} disabled={spin} onPress={() => void press()}
      style={[u.btn, danger && { backgroundColor: '#FF3B30' }, res === 'ok' && { backgroundColor: '#34C759' }, res === 'fail' && { backgroundColor: '#8E1B14' }, spin && { opacity: 0.6 }]}>
      {spin ? <ActivityIndicator color={fg} size="small" /> : !!icon && <Icon name={icon} size={16} color={fg} />}
      <Text style={[u.btnT, danger && { color: '#fff' }, res === 'fail' && { color: '#fff' }]}>{res === 'ok' ? '✓ Done' : res === 'fail' ? '✕ Failed' : label}</Text>
    </Pressable>
  );
}

export function Field(p: TextInputProps & { label?: string; error?: boolean }) {
  return (
    <View style={{ marginTop: 12 }}>
      {!!p.label && <Text style={u.lbl}>{p.label}</Text>}
      <AppInput {...p} accessibilityLabel={p.label ?? p.placeholder} style={[{ height: 44, paddingVertical: 0 }, p.style]} />
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[u.chip, on && { backgroundColor: O }]}>
      <Text style={[u.chipT, on && { color: '#000' }]}>{label}</Text>
    </Pressable>
  );
}

export const u = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  h: { color: '#fff', fontSize: 18, fontWeight: '800' },
  h3: { color: '#fff', fontSize: 15, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4 },
  bg: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', zIndex: 30 },
  sheet: { maxHeight: '88%', backgroundColor: '#0A0A0B', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 20, paddingBottom: 28 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  gh: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  ght: { color: O, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  gbox: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  div: { borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  rowT: { color: '#fff', fontSize: 13, fontWeight: '700' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  sw: { width: 36, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', padding: 2 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  btn: { flexDirection: 'row', gap: 8, height: 48, borderRadius: 12, backgroundColor: O, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnT: { color: '#000', fontWeight: '800', fontSize: 14 },
  lbl: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff', paddingHorizontal: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.06)' },
  chipT: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  card: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#0D0D0F', padding: 14 },
});
