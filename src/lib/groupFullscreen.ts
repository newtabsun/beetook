// True while a single group chat is open: Inbox header, tabs and the bottom nav hide so the chat is full screen.
import { useSyncExternalStore } from 'react';

let open = false;
const subs = new Set<() => void>();
export function setGroupFullscreen(v: boolean) {
  if (open === v) return;
  open = v;
  subs.forEach((f) => f());
}
export const useGroupFullscreen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open);
