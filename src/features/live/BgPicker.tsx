import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LIVE_BGS, bgSource, loadRemoteBgs, onRemoteBgs, remoteBgs, type BgItem } from './liveBackgrounds';

const KEY = 'live_bg_v1';
let current: string | null = null;
const subs = new Set<() => void>();
void loadRemoteBgs();
// A saved bundled choice that no longer exists is dropped; admin-added keys stay until the server list loads.
void AsyncStorage.getItem(KEY).then((v) => {
  current = v && (bgSource(v) != null || !/^bg\d+$/.test(v)) ? v : null;
  if (v && current === null) void AsyncStorage.removeItem(KEY).catch(() => undefined);
  subs.forEach((f) => f());
}).catch(() => undefined);

/** Persisted live background choice (kept until the user changes it). */
export function setLiveBg(k: string | null) {
  current = k;
  subs.forEach((f) => f());
  void (k ? AsyncStorage.setItem(KEY, k) : AsyncStorage.removeItem(KEY)).catch(() => undefined);
}
export function useLiveBg() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
}

const NONE: BgItem = { key: '', thumb: 0 };

export const BgPicker = memo(function BgPicker({ value, onPick }: { value: string | null; onPick: (k: string | null) => void }) {
  const [extra, setExtra] = useState<BgItem[]>(remoteBgs());
  useEffect(() => onRemoteBgs(() => setExtra([...remoteBgs()])), []);
  const DATA: BgItem[] = [NONE, ...LIVE_BGS, ...extra];
  return (
    <FlatList horizontal data={DATA} keyExtractor={(i) => i.key || 'none'} showsHorizontalScrollIndicator={false}
      initialNumToRender={8} windowSize={5} removeClippedSubviews contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}
      renderItem={({ item }) => {
        const on = (value ?? '') === item.key;
        return (
          <Pressable accessibilityLabel={item.key ? `Background ${item.key}` : 'No background'} onPress={() => onPick(item.key || null)} style={[s.cell, on && s.on]}>
            {item.key ? <Image source={item.thumb} style={s.img} resizeMode="cover" fadeDuration={0} /> : <View style={s.none}><Text style={s.noneT}>None</Text></View>}
          </Pressable>
        );
      }} />
  );
});

const s = StyleSheet.create({
  cell: { width: 54, height: 90, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', backgroundColor: 'rgba(0,0,0,0.5)' },
  on: { borderColor: '#FFA500' },
  img: { width: '100%', height: '100%' },
  none: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noneT: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
