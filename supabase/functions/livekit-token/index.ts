import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2';

const P = 'app_9e1318caf6_';
const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (b: Record<string, unknown>, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const httpUrl = (u: string) => u.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');

type Role = 'host' | 'guest' | 'viewer';
const PUBLISH = [TrackSource.MICROPHONE, TrackSource.CAMERA];

const hits = new Map<string, number[]>();
function limited(uid: string): boolean {
  const now = Date.now();
  const l = (hits.get(uid) ?? []).filter((t) => now - t < 60_000);
  l.push(now); hits.set(uid, l);
  return l.length > 30;
}

async function roleOf(db: ReturnType<typeof admin>, uid: string, roomId: string) {
  const { data: room } = await db.from(`${P}live_rooms`).select('id,host_id,is_live,join_fee,mode').eq('id', roomId).maybeSingle();
  if (!room) return { error: 'Live not found', status: 404 } as const;
  if (!room.is_live) return { error: 'This live has ended', status: 410 } as const;
  if (room.host_id === uid) return { role: 'host' as Role, room } as const;
  const [seat, kicked, paid] = await Promise.all([
    db.from(`${P}live_seats`).select('idx').eq('room_id', roomId).eq('user_id', uid).limit(1).maybeSingle(),
    db.from(`${P}live_viewers`).select('kicked').eq('room_id', roomId).eq('user_id', uid).maybeSingle(),
    Number(room.join_fee) > 0 ? db.from(`${P}live_joins`).select('user_id').eq('room_id', roomId).eq('user_id', uid).maybeSingle() : Promise.resolve({ data: true }),
  ]);
  if (kicked.data?.kicked) return { error: 'You were removed from this live', status: 403 } as const;
  if (!paid.data) return { error: 'Joining fee not paid', status: 402 } as const;
  return { role: (seat.data ? 'guest' : 'viewer') as Role, room } as const;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = env('LIVEKIT_URL'), key = env('LIVEKIT_API_KEY'), secret = env('LIVEKIT_API_SECRET');
    if (!url || !key || !secret) return reply({ error: 'Live streaming is not configured yet' }, 503);
    const db = admin();
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await db.auth.getUser(jwt);
    if (!u.user) return reply({ error: 'Please sign in first' }, 401);
    const uid = u.user.id;
    if (limited(uid)) return reply({ error: 'Too many requests' }, 429);
    const body = await req.json().catch(() => ({})) as { roomId?: string; action?: string };
    const roomId = String(body.roomId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return reply({ error: 'Invalid room' }, 400);
    const svc = new RoomServiceClient(httpUrl(url), key, secret);

    // Ends the live for everybody: DB first (source of truth), then an instant "live_ended" notice, then the room is deleted
    // (clients that miss the notice still get a ROOM_DELETED disconnect).
    const closeEverything = async () => {
      await db.from(`${P}live_rooms`).update({ is_live: false, ended_at: new Date().toISOString() }).eq('id', roomId).eq('is_live', true);
      await svc.sendData(roomId, new TextEncoder().encode('{}'), DataPacket_Kind.RELIABLE, { topic: 'live_ended' }).catch(() => undefined);
      await new Promise((res) => setTimeout(res, 400));
      await svc.deleteRoom(roomId).catch(() => undefined);
    };

    if (body.action === 'end') {
      const { data: r } = await db.from(`${P}live_rooms`).select('host_id').eq('id', roomId).maybeSingle();
      if (!r || r.host_id !== uid) return reply({ error: 'Only the host can end the live' }, 403);
      await closeEverything();
      return reply({ ok: true });
    }

    // Host crashed / lost the network: a viewer asks after a grace period; the server re-checks before closing anything.
    if (body.action === 'reap') {
      const { data: r } = await db.from(`${P}live_rooms`).select('host_id,is_live,created_at').eq('id', roomId).maybeSingle();
      if (!r) return reply({ error: 'Live not found' }, 404);
      if (!r.is_live) return reply({ ok: true, ended: true });
      if (Date.now() - new Date(r.created_at).getTime() < 60_000) return reply({ ok: true, ended: false });
      const people = await svc.listParticipants(roomId).catch(() => []);
      if (!people.some((p) => p.identity === uid)) return reply({ error: 'Not in this live' }, 403);
      if (people.some((p) => p.identity === r.host_id)) return reply({ ok: true, ended: false });
      await closeEverything();
      return reply({ ok: true, ended: true });
    }

    const r = await roleOf(db, uid, roomId);
    if ('error' in r) return reply({ error: r.error }, r.status);

    // Car racing duel: the two players live in two different LiveKit rooms (host room / opponent room). Everybody in one of
    // them gets a subscribe-only token for the OTHER room, so the competitor cards show the real camera instead of an avatar.
    if (body.action === 'peer') {
      const { data: g } = await db.from(`${P}game_sessions`).select('host_room,opp_room').eq('status', 'active')
        .or(`host_room.eq.${roomId},opp_room.eq.${roomId}`).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!g || !g.opp_room) return reply({ error: 'No game is running' }, 404);
      const other = String(g.host_room === roomId ? g.opp_room : g.host_room);
      const { data: o } = await db.from(`${P}live_rooms`).select('id,is_live').eq('id', other).maybeSingle();
      if (!o?.is_live) return reply({ error: 'The other live has ended' }, 410);
      const pt = new AccessToken(key, secret, { identity: uid, ttl: '10m', metadata: JSON.stringify({ role: 'viewer', peer: true }) });
      pt.addGrant({ roomJoin: true, room: other, canSubscribe: true, canPublish: false, canPublishData: false, canPublishSources: [], roomAdmin: false });
      return reply({ token: await pt.toJwt(), url, role: 'viewer' });
    }

    if (body.action === 'sync') {
      const can = r.role !== 'viewer';
      await svc.updateParticipant(roomId, uid, undefined, {
        canSubscribe: true, canPublish: can, canPublishData: true, canPublishSources: can ? PUBLISH : [],
      }).catch(() => undefined);
      return reply({ ok: true, role: r.role });
    }

    const can = r.role !== 'viewer';
    const at = new AccessToken(key, secret, { identity: uid, ttl: '10m', metadata: JSON.stringify({ role: r.role }) });
    at.addGrant({
      roomJoin: true, room: roomId, canSubscribe: true, canPublish: can, canPublishData: true,
      canPublishSources: can ? PUBLISH : [], roomAdmin: false,
    });
    return reply({ token: await at.toJwt(), url, role: r.role });
  } catch (e) {
    console.error('livekit-token', e instanceof Error ? e.message : e);
    return reply({ error: 'Could not join the live' }, 500);
  }
});
