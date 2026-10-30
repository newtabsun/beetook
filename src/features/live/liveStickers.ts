// Live stickers: five text-label looks, plus the host's saved sticker kit (reused by every next live).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TextStyle, ViewStyle } from 'react-native';
import type { LiveSticker } from '../../lib/api';

export interface TextLook { name: string; box: ViewStyle; text: TextStyle }
const base: ViewStyle = { paddingHorizontal: 14, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 };

/** Neon label: dark base with a glowing border. The main text itself has no glow, so it stays sharp. */
const neon = (name: string, bg: string, c: string, radius = 12): TextLook => ({
  name,
  box: { ...base, backgroundColor: bg, borderRadius: radius, borderWidth: 2, borderColor: c, shadowColor: c, shadowOpacity: 0.95, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  text: { color: c },
});

// Text colour is always the opposite of its label background (dark on light, light on dark) for a clear read.
export const TEXT_LOOKS: TextLook[] = [
  { name: 'Sunset', box: { ...base, backgroundColor: '#FFB347', borderRadius: 14, borderWidth: 2, borderColor: '#B34700' }, text: { color: '#2B1000' } },
  { name: 'Candy', box: { ...base, backgroundColor: '#FFD6EA', borderRadius: 999, paddingHorizontal: 20, borderWidth: 2, borderColor: '#B0125F' }, text: { color: '#7A0040' } },
  { name: 'Ocean', box: { ...base, backgroundColor: '#CFF1FF', borderRadius: 6, borderBottomWidth: 5, borderBottomColor: '#075985' }, text: { color: '#04304D' } },
  { name: 'Gold', box: { ...base, backgroundColor: '#FFD400', borderRadius: 10, borderWidth: 3, borderColor: '#111' }, text: { color: '#111' } },
  { name: 'Night', box: { ...base, backgroundColor: 'rgba(10,10,20,0.92)', borderRadius: 12, borderWidth: 2, borderColor: '#FFA500' }, text: { color: '#FFA500' } },
  neon('Neon Pink', '#14001C', '#FF2BD6'),
  neon('Neon Green', '#021A0B', '#39FF14', 999),
  neon('Neon Cyan', '#00141C', '#00F0FF'),
  neon('Neon Yellow', '#1A1700', '#FFF200', 8),
  neon('Neon Violet', '#0B0020', '#B26BFF', 999),
];

export const isImageSticker = (s: LiveSticker) => s.kind === 'image';
export const findTextSticker = (l: LiveSticker[]) => l.find((s) => !isImageSticker(s));
export const findImageSticker = (l: LiveSticker[]) => l.find(isImageSticker);

const KEY = 'live_stickers_v1';
export async function loadStickerKit(): Promise<LiveSticker[]> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as LiveSticker[];
    return Array.isArray(v) ? v.filter((s) => s && typeof s.x === 'number' && typeof s.y === 'number').map((s) => ({ ...s, hidden: false })) : [];
  } catch { return []; }
}
/** The saved kit always keeps every sticker visible: hiding with × only applies to the live in progress. */
export function saveStickerKit(list: LiveSticker[]) {
  void AsyncStorage.setItem(KEY, JSON.stringify(list.map((s) => ({ ...s, hidden: false })))).catch(() => undefined);
}
