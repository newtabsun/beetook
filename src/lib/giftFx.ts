/** Tiny event bus: any screen calls playGift(); the single GiftFxHost (mounted once in App) plays the animation queue. */
import type { GiftItem } from './gifts';

export interface GiftPlay { gift: GiftItem; qty: number; from: string; to?: string }
type Listener = (p: GiftPlay) => void;
const listeners = new Set<Listener>();

export const onGiftPlay = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const playGift = (p: GiftPlay) => listeners.forEach((l) => l(p));
