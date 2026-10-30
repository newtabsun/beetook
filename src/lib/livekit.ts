// LiveKit Cloud transport (mobile + web). Only the public LIVEKIT_URL reaches the client (inside the token reply);
// the API secret lives in the `livekit-token` edge function. Tokens are minted per room with a server-derived role.
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type LiveRole = 'host' | 'guest' | 'viewer';
export interface LiveToken { token: string; url: string; role: LiveRole }

let globalsDone = false;
/** WebRTC globals for React Native (no-op on web, where the browser already has WebRTC). */
export function initLiveKit() {
  if (globalsDone || Platform.OS === 'web') return;
  globalsDone = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('@livekit/react-native') as { registerGlobals: () => void }).registerGlobals();
}

async function call<T>(roomId: string, action: 'token' | 'sync' | 'end' | 'reap' | 'peer'): Promise<T> {
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { roomId, action } });
  if (error) {
    // functions.invoke hides the JSON body of non-2xx replies in `context`; surface the server message.
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined) : undefined;
    throw new Error(msg || 'Could not join the live');
  }
  return data as T;
}

export const fetchLiveToken = (roomId: string) => call<LiveToken>(roomId, 'token');
/** During a game: subscribe-only token for the OTHER player's room (the competitors stream from different rooms). */
export const fetchPeerToken = (roomId: string) => call<LiveToken>(roomId, 'peer');
/** Re-checks my role on the server and updates my LiveKit permissions in place (seat taken / left) — no reconnect. */
export const syncLivePermissions = (roomId: string) => call<{ ok: boolean; role: LiveRole }>(roomId, 'sync');
/** Host: marks the live ended, tells everybody and closes the LiveKit room so all clients are disconnected at once. */
export const closeLiveRoom = (roomId: string) => call<{ ok: boolean }>(roomId, 'end');
/** Anyone in the room: asks the server to close a live whose host is gone (crash / lost network) after the grace period. */
export const reapLive = (roomId: string) => call<{ ok: boolean; ended: boolean }>(roomId, 'reap');
