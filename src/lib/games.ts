// Live game sessions: invite → escrow → realtime duel → server settlement.
// All coin movement happens in SECURITY DEFINER RPCs (supabase/migrations/*_live_games.sql).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, T } from './supabase';
import { useActiveInterval } from './appActive';
import { observeServerTime } from './serverClock';
import { fetchMiniProfiles, subscribeTables, type MiniProfile } from './api';
import { moveId, type Move, type MoveKind } from '../features/games/carRace';

const P = 'app_9e1318caf6_';
export const GAME_TABLE = `${P}game_sessions`;
const R = {
  invite: `${P}game_invite`, cancel: `${P}game_cancel`, respond: `${P}game_respond`, push: `${P}game_push`,
  support: `${P}game_support`, settle: `${P}game_settle`, forfeit: `${P}game_forfeit`,
} as const;

export type GameStatus = 'pending' | 'declined' | 'expired' | 'cancelled' | 'active' | 'finished';
export interface GameSession {
  id: string; game: string; host_id: string; opponent_id: string; host_room: string; opp_room: string | null;
  stake: number; duration_s: number; status: GameStatus; host_score: number; opp_score: number;
  host_support: number; opp_support: number; winner_id: string | null; result: 'win' | 'draw' | 'forfeit' | null;
  payout: number; settled: boolean; expires_at: string; started_at: string | null; ends_at: string | null;
  finished_at: string | null; created_at: string;
}

export const LIVE_GAMES = [
  { key: 'front-war', name: 'Front War' }, { key: 'car-racing', name: 'Car Racing' }, { key: 'motor-racing', name: 'Motor Racing' },
  { key: 'marathon', name: 'Marathon' }, { key: 'boxing-match', name: 'Boxing Match' }, { key: 'shootout', name: 'Shootout' },
  { key: 'number-spin', name: 'Number Spin' }, { key: 'fast-tap', name: 'Fast Tap' }, { key: 'gift-bomb', name: 'Gift Bomb' },
] as const;
/** Games with a playable live duel. The session flow is generic; add keys here as more duels ship. */
export const PLAYABLE = new Set<string>(['car-racing']);
export const gameName = (k: string) => LIVE_GAMES.find((g) => g.key === k)?.name ?? k;

/** Missing table/RPC (migration not applied yet) → readable message instead of a raw PostgREST error. */
export const GAMES_NOT_READY = 'Live games are not set up on the server yet';
function check<D>(r: { data: D; error: { message: string; code?: string } | null }): D {
  if (r.error) {
    const m = r.error.message || '';
    if (/does not exist|schema cache|Could not find the function|PGRST20[0-9]|42P01|42883/i.test(m + (r.error.code ?? ''))) throw new Error(GAMES_NOT_READY);
    throw new Error(m.replace(/^.*?ERROR:\s*/, ''));
  }
  return r.data;
}
const toNum = (s: GameSession): GameSession => ({ ...s, stake: Number(s.stake), host_score: Number(s.host_score), opp_score: Number(s.opp_score),
  host_support: Number(s.host_support), opp_support: Number(s.opp_support), payout: Number(s.payout) });

export async function inviteToGame(game: string, opponent: string, roomId: string, stake: number, durationS: number): Promise<string> {
  return check(await supabase.rpc(R.invite, { p_game: game, p_opponent: opponent, p_room: roomId, p_stake: Math.floor(stake), p_duration: durationS })) as string;
}
export async function cancelInvite(id: string) { check(await supabase.rpc(R.cancel, { p_session: id })); }
export async function respondInvite(id: string, accept: boolean, roomId: string | null): Promise<GameSession> {
  return toNum(check(await supabase.rpc(R.respond, { p_session: id, p_accept: accept, p_room: roomId ?? '' })) as GameSession);
}
export async function pushScore(id: string, score: number) { check(await supabase.rpc(R.push, { p_session: id, p_score: score })); }
export async function supportSide(id: string, side: 0 | 1, coins: number): Promise<number> {
  return Number(check(await supabase.rpc(R.support, { p_session: id, p_side: side, p_coins: coins })));
}
export async function settleGame(id: string): Promise<GameSession> { return toNum(check(await supabase.rpc(R.settle, { p_session: id })) as GameSession); }
export async function forfeitGame(id: string): Promise<GameSession> { return toNum(check(await supabase.rpc(R.forfeit, { p_session: id })) as GameSession); }
export async function fetchGame(id: string): Promise<GameSession | null> {
  const d = check(await supabase.from(GAME_TABLE).select('*').eq('id', id).maybeSingle()) as GameSession | null;
  return d ? toNum(d) : null;
}
/** Latest active (or just-finished) game shown in this live room. */
export async function fetchRoomGame(roomId: string): Promise<GameSession | null> {
  const rows = check(await supabase.from(GAME_TABLE).select('*').or(`host_room.eq.${roomId},opp_room.eq.${roomId}`)
    .in('status', ['active', 'finished']).order('created_at', { ascending: false }).limit(1)) as GameSession[];
  const g = rows[0] ? toNum(rows[0]) : null;
  if (g?.status === 'finished' && Date.now() - Date.parse(g.finished_at ?? g.created_at) > 20_000) return null;
  return g;
}
export async function fetchIncomingInvites(me: string): Promise<GameSession[]> {
  const rows = check(await supabase.from(GAME_TABLE).select('*').eq('opponent_id', me).eq('status', 'pending')
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(3)) as GameSession[];
  return rows.map(toNum);
}

/** The live room this device is currently hosting (used to accept invites without leaving it). */
let hostingRoom: string | null = null;
export const setHostingRoom = (id: string | null) => { hostingRoom = id; };
export const getHostingRoom = () => hostingRoom;

// ---- opponent picker data ----
export interface Candidate extends MiniProfile { public_id?: number | null; friend: boolean; live: boolean; online: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function status(ids: string[]): Promise<{ online: Set<string>; live: Set<string> }> {
  if (!ids.length) return { online: new Set(), live: new Set() };
  const [on, lv] = await Promise.all([
    supabase.rpc(`${P}online_ids`, { p_ids: ids }),
    supabase.from(T.live).select('host_id').eq('is_live', true).in('host_id', ids),
  ]);
  const online = new Set(((on.data ?? []) as (string | { [k: string]: string })[]).map((x) => (typeof x === 'string' ? x : Object.values(x)[0])));
  const live = new Set(((lv.data ?? []) as { host_id: string }[]).map((x) => x.host_id));
  return { online, live };
}
const rank = (c: Candidate) => (c.friend ? 0 : 10) + (c.live ? 0 : c.online ? 1 : 5);

/** Friends (people I follow) first, live > online; search matches username, name, public id or user id. */
export async function findOpponents(me: string, query: string): Promise<Candidate[]> {
  const q = query.trim().replace(/^@/, '');
  const follows = (check(await supabase.from(T.follows).select('following_id').eq('follower_id', me).limit(200)) as { following_id: string }[]).map((r) => r.following_id);
  let ids: string[];
  if (!q) ids = follows;
  else {
    const safe = q.replace(/[%,()*]/g, '');
    const ors = [`username.ilike.%${safe}%`, `display_name.ilike.%${safe}%`];
    if (/^\d{1,12}$/.test(safe)) ors.push(`public_id.eq.${safe}`);
    if (UUID.test(safe)) ors.push(`id.eq.${safe}`);
    ids = (check(await supabase.from(T.profiles).select('id').or(ors.join(',')).limit(40)) as { id: string }[]).map((r) => r.id);
  }
  ids = ids.filter((x) => x !== me);
  if (!ids.length) return [];
  const [profiles, st, pub] = await Promise.all([
    fetchMiniProfiles(ids), status(ids),
    supabase.from(T.profiles).select('id,public_id').in('id', ids),
  ]);
  const pid = new Map(((pub.data ?? []) as { id: string; public_id: number | null }[]).map((r) => [r.id, r.public_id]));
  const fset = new Set(follows);
  return ids.filter((i) => profiles[i]).map((i) => ({ ...profiles[i], public_id: pid.get(i) ?? null, friend: fset.has(i), live: st.live.has(i), online: st.online.has(i) || st.live.has(i) }))
    .sort((a, b) => rank(a) - rank(b));
}

// Same content → keep the old object, so a poll that changed nothing never re-renders the live room.
const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

// ---- hooks ----
/** Subscribe to one session by id (realtime; a slow foreground-only poll is the safety net). */
export function useGameSession(id: string | null) {
  const [g, setG] = useState<GameSession | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    const n = await fetchGame(id).catch(() => null);
    setG((cur) => (sameJson(cur, n) ? cur : n));
  }, [id]);
  useEffect(() => {
    if (!id) { setG(null); return undefined; }
    void load();
    return subscribeTables(`game-${id}`, [{ table: GAME_TABLE, filter: `id=eq.${id}` }], (row) => {
      observeServerTime(row.updated_at, true);
      if (row.id) setG((cur) => { const n = toNum(row as unknown as GameSession); return sameJson(cur, n) ? cur : n; });
    });
  }, [id, load]);
  useActiveInterval(load, 8000, !!id);
  return { game: g, reload: load };
}

/** Active game for a live room; realtime on both room columns + polling fallback. */
export function useRoomGame(roomId: string) {
  const [game, setGame] = useState<GameSession | null>(null);
  const [error, setError] = useState('');
  const dismissed = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const g = await fetchRoomGame(roomId); setError('');
      const next = g && g.id === dismissed.current ? null : g;
      setGame((cur) => (sameJson(cur, next) ? cur : next));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [roomId]);
  useEffect(() => {
    void load();
    const off = subscribeTables(`roomgame-${roomId}`, [{ table: GAME_TABLE, filter: `host_room=eq.${roomId}` }, { table: GAME_TABLE, filter: `opp_room=eq.${roomId}` }],
      (row) => { const r = row as unknown as GameSession; if (r.id && r.id !== dismissed.current && (r.status === 'active' || r.status === 'finished')) setGame((cur) => { const n = toNum(r); return sameJson(cur, n) ? cur : n; }); });
    return off;
  }, [roomId, load]);
  useActiveInterval(load, 6000);
  const dismiss = useCallback(() => { dismissed.current = game?.id ?? null; setGame(null); }, [game?.id]);
  return { game, setGame, error, reload: load, dismiss };
}

// ---- live joining fee + earnings ----
export const MIN_STAKE = 500;
export async function liveJoin(roomId: string, pay: boolean): Promise<{ fee: number; paid: boolean }> {
  const r = check(await supabase.rpc(`${P}live_join`, { p_room: roomId, p_pay: pay })) as { fee: number; paid: boolean };
  return { fee: Number(r.fee), paid: !!r.paid };
}
export async function liveEarnings(roomId: string): Promise<{ game: number; joining: number }> {
  const r = check(await supabase.rpc(`${P}live_earnings`, { p_room: roomId })) as { game: number; joining: number };
  return { game: Number(r.game), joining: Number(r.joining) };
}

// ---- coin-priced in-game moves (gas / brake) ----
export const GAME_ACTIONS_TABLE = `${P}game_actions`;
export interface ActionRow extends Move { }
/** One paid move; the action id makes retries idempotent, so a move is never charged twice. */
export async function gameMove(sessionId: string, side: 0 | 1, kind: MoveKind): Promise<{ coins: number; spent: number }> {
  const r = check(await supabase.rpc(`${P}game_action`, { p_action: moveId(), p_session: sessionId, p_side: side, p_kind: kind })) as { coins: number; spent?: number };
  return { coins: Number(r.coins), spent: Number(r.spent ?? 0) };
}
/** All moves of a session, oldest first (paged: PostgREST caps a response at 1000 rows). With `since`, only
 *  moves from that instant on. The old "latest 120" cut dropped a car's oldest taps once a race had more than
 *  120 moves (busy supporters), which instantly slowed that car and threw the other one ahead. */
export async function fetchGameActions(sessionId: string, since?: string): Promise<ActionRow[]> {
  const PAGE = 1000;
  const out: ActionRow[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    let q = supabase.from(GAME_ACTIONS_TABLE).select('*').eq('session_id', sessionId);
    if (since) q = q.gte('created_at', since);
    const rows = check(await q.order('created_at', { ascending: true }).order('action_id', { ascending: true }).range(from, from + PAGE - 1)) as ActionRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Moves of the running game (realtime + 2 s polling fallback), oldest first. */
export function useGameActions(sessionId: string | null, active: boolean) {
  const [moves, setMoves] = useState<ActionRow[]>([]);
  const lastAt = useRef<string | undefined>(undefined);
  // Incremental fetch merged by action id: the same array is kept when nothing is new, so the race
  // integral is not rebuilt on every poll.
  const load = useCallback(async () => {
    if (!sessionId) return;
    // 10 s overlap: a move written earlier can become visible later than a newer one (commit order),
    // so asking only for "after the newest we have" would lose it for good. Duplicates are dropped by id.
    const since = lastAt.current ? new Date(Date.parse(lastAt.current) - 10_000).toISOString() : undefined;
    const rows = await fetchGameActions(sessionId, since).catch(() => null);
    if (!rows?.length) return;
    const newest = rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), rows[0].created_at);
    if (!lastAt.current || newest > lastAt.current) lastAt.current = newest;
    setMoves((cur) => {
      const seen = new Set(cur.map((x) => x.action_id));
      const add = rows.filter((r) => !seen.has(r.action_id));
      if (!add.length) return cur;
      const next = [...cur, ...add].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
      return next;
    });
  }, [sessionId]);
  useEffect(() => {
    lastAt.current = undefined; setMoves([]);
    if (!sessionId) return undefined;
    void load();
    return subscribeTables(`moves-${sessionId}`, [{ table: GAME_ACTIONS_TABLE, filter: `session_id=eq.${sessionId}` }], (row) => {
      const m = row as unknown as ActionRow;
      observeServerTime(m.created_at, true); // a realtime row arrives right after the server wrote it
      if (m.action_id) setMoves((cur) => {
        if (cur.some((x) => x.action_id === m.action_id)) return cur;
        return [...cur, m];
      });
    });
  }, [sessionId, load]);
  useActiveInterval(load, active ? 4000 : 12000, !!sessionId);
  return moves;
}
