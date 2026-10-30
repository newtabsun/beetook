import { handleOf } from '../../lib/username';
// Live game UI: host invite sheet, global incoming-invite modal, VS card + duel stage, support and results.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { GAME_SVG } from '../../assets/liveGames';
import { VipAvatar } from '../../components/Vip';
import { AppModal } from '../../components/AppModal';
import { Icon } from '../../components/Icons';
import { notify } from '../../lib/notify';
import { friendlyError } from '../../lib/errors';
import { canGoLive } from '../../lib/liveAccess';
import { LIVE_DENIED_MESSAGE } from '../../lib/liveRule';
import { formatCoins, useWallet } from '../../lib/wallet';
import { createLiveRoom, fetchMiniProfiles, myId, type MiniProfile } from '../../lib/api';
import { openLive } from '../../lib/presence';
import {
  GAME_TABLE, cancelInvite, fetchIncomingInvites, findOpponents, forfeitGame, gameMove, gameName, getHostingRoom, inviteToGame,
  respondInvite, settleGame, useGameActions, useGameSession, type Candidate, type GameSession,
} from '../../lib/games';
import { useRaceAudio } from './useRaceAudio';
import { MOVE_COST, STEP, baselineDistance, carState, type Move, type MoveKind } from './carRace';
import { ROAD_PX_PER_M, leadOffset, stepView } from './raceView';
import { serverNow } from '../../lib/serverClock';
import { SmokePlume, createEmitter, createSmokePool, observeFrame, smokeDrive, smokeSize, stepSmoke } from './exhaustSmoke';
import { LiveVideo, useTileCtl, useVideoOf } from '../live/LiveVideo';
import { bgSource } from '../live/liveBackgrounds';
import { useLiveBg } from '../live/BgPicker';
import { subscribeTables } from '../../lib/api';
import { colors } from '../../theme';
import { isAppActive, useAppActive } from '../../lib/appActive';
import { isLowEndDevice } from '../../lib/device';

const LOW = isLowEndDevice;
const OR = colors.primary;
const BLUE = '#06b6d4';
const AMBER = '#22c55e'; // car 2 (green)
const STAKES = [500, 1000, 2000, 5000, 10000];
const DURATIONS = [1, 3, 5, 10, 15, 30];
const nameOf = (p?: MiniProfile | null) => p?.display_name || p?.username || 'Player';
const secsLeft = (iso?: string | null, now = Date.now()) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0);
const mins = (t: number) => `${Math.round(t / 60)} min`;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

function useNow(ms = 250) {
  const [now, setNow] = useState(serverNow());
  // Server clock (not the phone's): every device and viewer sees the same race. Foreground only.
  useEffect(() => { const t = setInterval(() => { if (isAppActive()) setNow(serverNow()); }, ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// ---------------- Host: invite sheet ----------------
export function GameInviteSheet({ game, roomId, me, onClose }: { game: string; roomId: string; me: string; onClose: () => void }) {
  const { coins } = useWallet();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Candidate[] | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<Candidate | null>(null);
  const [stake, setStake] = useState(500);
  const [custom, setCustom] = useState('');
  const [dur, setDur] = useState(1);
  const [customDur, setCustomDur] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const { game: pending } = useGameSession(sent);
  const now = useNow(500);

  useEffect(() => {
    let alive = true; setList(null);
    const t = setTimeout(() => {
      findOpponents(me, q).then((r) => { if (alive) { setList(r); setErr(''); } }).catch((e) => { if (alive) { setList([]); setErr(friendlyError(e)); } });
    }, q ? 350 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, me]);

  const amount = custom ? Math.max(0, Math.floor(Number(custom) || 0)) : stake;
  const minutes = customDur ? Math.floor(Number(customDur) || 0) : dur;
  const badDur = minutes < 1 || minutes > 60;
  const low = amount < 500;
  const short = coins !== null && amount > coins;
  const send = async () => {
    if (!pick) return;
    setBusy(true);
    try { setSent(await inviteToGame(game, pick.id, roomId, amount, minutes * 60)); } catch (e) { notify('Invite failed', friendlyError(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!pending) return;
    if (pending.status === 'active') { notify('Game on!', `${nameOf(pick)} accepted. Good luck!`); onClose(); }
    else if (pending.status === 'declined' || pending.status === 'expired' || pending.status === 'cancelled') {
      notify(pending.status === 'declined' ? 'Invite declined' : pending.status === 'expired' ? 'No answer in time' : 'Invite cancelled');
      setSent(null);
    }
  }, [pending?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = pending?.status === 'pending' ? secsLeft(pending.expires_at, now) : 0;
  useEffect(() => { if (sent && pending?.status === 'pending' && left === 0) void settleGame(sent).catch(() => undefined); }, [left, sent, pending?.status]);

  return (
    <AppModal onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.sheetHead}>
          <SvgXml xml={GAME_SVG[game]} width={36} height={36} />
          <View style={{ flex: 1 }}><Text style={st.h}>{gameName(game)}</Text><Text style={st.sub}>Challenge a player · winner takes the pot</Text></View>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={st.iconBtn}><Icon name="x" size={16} /></Pressable>
        </View>

        {sent ? (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 10 }}>
            <VipAvatar userId={pick?.id} uri={pick?.avatar_url} name={nameOf(pick)} size={72} />
            <Text style={st.h}>Waiting for {nameOf(pick)}…</Text>
            <Text style={st.sub}>Stake 🪙 {formatCoins(amount)} each · {minutes} min</Text>
            <View style={st.ring}><Text style={st.ringT}>{left || '…'}</Text></View>
            <Pressable onPress={() => { void cancelInvite(sent).catch(() => undefined); setSent(null); }} style={[st.btn, st.btnGhost]}><Text style={st.btnT}>Cancel invite</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={st.search}>
              <Icon name="search" size={14} color="rgba(255,255,255,0.5)" />
              <TextInput value={q} onChangeText={setQ} placeholder="Search username, name or ID" placeholderTextColor="rgba(255,255,255,0.4)" style={st.searchIn} autoCapitalize="none" />
            </View>
            <Text style={st.label}>{q ? 'Results' : 'Friends'} · only online or live players can be invited</Text>
            <ScrollView style={{ maxHeight: 230 }} keyboardShouldPersistTaps="handled">
              {list === null && <ActivityIndicator color={OR} style={{ marginVertical: 20 }} />}
              {list !== null && !list.length && <Text style={[st.sub, { textAlign: 'center', paddingVertical: 20 }]}>{err || (q ? 'No players found' : 'No friends yet — search by username or ID')}</Text>}
              {list?.map((c) => {
                const ok = c.online || c.live; const on = pick?.id === c.id;
                return (
                  <Pressable key={c.id} disabled={!ok} onPress={() => setPick(c)} style={[st.row, on && st.rowOn, !ok && { opacity: 0.4 }]}>
                    <VipAvatar userId={c.id} uri={c.avatar_url} name={nameOf(c)} size={40} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={st.name} numberOfLines={1}>{nameOf(c)}</Text>
                        {c.friend && <View style={[st.badge, { backgroundColor: 'rgba(255,165,0,0.2)' }]}><Text style={[st.badgeT, { color: OR }]}>FRIEND</Text></View>}
                      </View>
                      <Text style={st.sub} numberOfLines={1}>{handleOf(c.username ?? 'user')}{c.public_id ? ` · ID ${c.public_id}` : ''}</Text>
                    </View>
                    {c.live ? <View style={[st.badge, { backgroundColor: '#FF2D55' }]}><Text style={st.badgeT}>LIVE</Text></View>
                      : c.online ? <View style={[st.badge, { backgroundColor: '#16a34a' }]}><Text style={st.badgeT}>ONLINE</Text></View>
                      : <Text style={st.sub}>offline</Text>}
                    {on && <Icon name="check" size={16} color={OR} />}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={st.label}>Stake per player · balance 🪙 {coins === null ? '…' : formatCoins(coins)}</Text>
            <View style={st.chips}>
              {STAKES.map((v) => <Pressable key={v} onPress={() => { setStake(v); setCustom(''); }} style={[st.chip, !custom && stake === v && st.chipOn]}><Text style={[st.chipT, !custom && stake === v && { color: '#000' }]}>{formatCoins(v)}</Text></Pressable>)}
              <TextInput value={custom} onChangeText={(t) => setCustom(t.replace(/\D/g, '').slice(0, 7))} placeholder="Custom ≥500" keyboardType="number-pad" placeholderTextColor="rgba(255,255,255,0.4)" style={[st.chip, st.chipIn, !!custom && st.chipOn]} />
            </View>
            <Text style={st.label}>Duration</Text>
            <View style={st.chips}>{DURATIONS.map((d) => <Pressable key={d} onPress={() => { setDur(d); setCustomDur(''); }} style={[st.chip, !customDur && dur === d && st.chipOn]}><Text style={[st.chipT, !customDur && dur === d && { color: '#000' }]}>{d} min</Text></Pressable>)}
              <TextInput value={customDur} onChangeText={(t) => setCustomDur(t.replace(/\D/g, '').slice(0, 2))} placeholder="1–60 min" keyboardType="number-pad" placeholderTextColor="rgba(255,255,255,0.4)" style={[st.chip, st.chipIn, !!customDur && st.chipOn]} /></View>
            {low && <Text style={st.warn}>Minimum stake is 500 coins</Text>}
            {badDur && <Text style={st.warn}>Duration must be 1 to 60 minutes</Text>}
            {short && <Text style={st.warn}>Not enough coins for this stake</Text>}
            <Pressable disabled={!pick || short || low || badDur || busy} onPress={send} style={[st.btn, { backgroundColor: OR, marginTop: 12, opacity: !pick || short || low || badDur || busy ? 0.4 : 1 }]}>
              {busy ? <ActivityIndicator color="#000" /> : <Text style={[st.btnT, { color: '#000' }]}>{pick ? `Challenge ${nameOf(pick)} · 🪙 ${formatCoins(amount)}` : 'Pick a player'}</Text>}
            </Pressable>
          </>
        )}
      </View>
    </AppModal>
  );
}

// ---------------- Everyone: incoming invite (mounted globally) ----------------
export function IncomingGameInvites({ userId }: { userId: string | null }) {
  const [inv, setInv] = useState<GameSession | null>(null);
  const [host, setHost] = useState<MiniProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const handled = useRef(new Set<string>());
  const now = useNow(500);
  const check = useCallback(async () => {
    if (!userId) return;
    const list = await fetchIncomingInvites(userId).catch(() => []);
    const next = list.find((x) => !handled.current.has(x.id)) ?? null;
    setInv((cur) => (cur && list.some((x) => x.id === cur.id) ? cur : next));
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    void check();
    const off = subscribeTables(`invites-${userId}`, [{ table: GAME_TABLE, filter: `opponent_id=eq.${userId}` }], () => void check());
    const t = setInterval(() => { if (isAppActive()) void check(); }, 8000);
    return () => { off(); clearInterval(t); };
  }, [userId, check]);
  useEffect(() => { if (inv) void fetchMiniProfiles([inv.host_id]).then((m) => setHost(m[inv.host_id] ?? null)); }, [inv?.host_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = inv ? secsLeft(inv.expires_at, now) : 0;
  useEffect(() => { if (inv && left === 0) { handled.current.add(inv.id); setInv(null); } }, [left, inv]);
  if (!inv) return null;
  const hosting = getHostingRoom();
  const close = () => { handled.current.add(inv.id); setInv(null); };
  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      if (!accept) { await respondInvite(inv.id, false, null); close(); return; }
      let room = hosting;
      let created = null;
      if (!room) {
        if (!(await canGoLive().catch(() => true))) { notify('Live access', LIVE_DENIED_MESSAGE); return; }
        created = await createLiveRoom(`${gameName(inv.game)} battle`, 'Gaming'); room = created.id;
      }
      const r = await respondInvite(inv.id, true, room);
      close();
      if (r.status !== 'active') return notify('Game unavailable', `This invite is ${r.status}.`);
      if (created) openLive(created);
    } catch (e) { notify('Could not join game', friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <AppModal onRequestClose={() => void answer(false)} animationType="fade">
      <View style={st.center}>
        <View style={st.invite}>
          <View style={st.inviteGlow} />
          <SvgXml xml={GAME_SVG[inv.game]} width={56} height={56} />
          <Text style={[st.h, { fontSize: 18, marginTop: 8 }]}>{gameName(inv.game)} challenge!</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <VipAvatar userId={inv.host_id} uri={host?.avatar_url} name={nameOf(host)} size={44} />
            <View><Text style={st.name}>{nameOf(host)}</Text><Text style={st.sub}>{handleOf(host?.username ?? 'user')} invites you to play live</Text></View>
          </View>
          <View style={st.stakeBox}><Text style={st.stakeT}>🪙 {formatCoins(inv.stake)}</Text><Text style={st.sub}>stake each · winner gets 🪙 {formatCoins(inv.stake * 2)} · {mins(inv.duration_s)}</Text></View>
          <View style={st.bar}><View style={[st.barFill, { width: `${(left / 30) * 100}%` }]} /></View>
          <Text style={st.sub}>{left}s to answer</Text>
          <Pressable disabled={busy} onPress={() => void answer(true)} style={[st.btn, { backgroundColor: OR, alignSelf: 'stretch', marginTop: 14 }]}>
            {busy ? <ActivityIndicator color="#000" /> : <Text style={[st.btnT, { color: '#000' }]}>{hosting ? 'Accept this game' : 'Accept & Go Live'}</Text>}
          </Pressable>
          <Pressable disabled={busy} onPress={() => void answer(false)} style={[st.btn, st.btnGhost, { alignSelf: 'stretch', marginTop: 8 }]}><Text style={st.btnT}>Decline</Text></Pressable>
        </View>
      </View>
    </AppModal>
  );
}

// ---------------- In-room game stage ----------------
// memo: the live room re-renders for chat / speaking / viewers; none of that may re-render the race.
export const LiveGameStage = memo(function LiveGameStage({ game, me, bg, onDone, onForfeitRef }: { game: GameSession; me: string; bg?: string | null; onDone: () => void; onForfeitRef?: { current: (() => void) | null } }) {
  const [people, setPeople] = useState<Record<string, MiniProfile>>({});
  const { refresh: refreshWallet, coins } = useWallet();
  const now = useNow(LOW ? 350 : 250);
  const side: 0 | 1 | null = me === game.host_id ? 0 : me === game.opponent_id ? 1 : null;
  const isPlayer = side !== null;
  const { game: live } = useGameSession(game.id);
  const session = live ?? game;
  useEffect(() => { void fetchMiniProfiles([game.host_id, game.opponent_id]).then(setPeople); }, [game.host_id, game.opponent_id]);

  const startsIn = secsLeft(session.started_at, now);
  const left = secsLeft(session.ends_at, now);
  const running = session.status === 'active' && startsIn === 0 && left > 0;

  // settlement: any client may trigger; the server only acts after ends_at and pays exactly once
  const settling = useRef(false);
  useEffect(() => {
    if (session.status !== 'active' || left > 0 || settling.current) return;
    settling.current = true;
    const t = setTimeout(() => void settleGame(session.id).catch(() => undefined).finally(() => { settling.current = false; }), 1200);
    return () => clearTimeout(t);
  }, [left, session.status, session.id]);
  useEffect(() => { if (session.status === 'finished') { void refreshWallet(); const t = setTimeout(onDone, 10_000); return () => clearTimeout(t); } }, [session.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onForfeitRef) return;
    onForfeitRef.current = isPlayer && session.status === 'active' ? () => void forfeitGame(session.id).catch(() => undefined) : null;
    return () => { onForfeitRef.current = null; };
  }, [isPlayer, session.status, session.id, onForfeitRef]);

  const h = people[session.host_id]; const o = people[session.opponent_id];
  const moves = useGameActions(session.id, running);
  const startedAt = session.started_at ? Date.parse(session.started_at) : null;
  const dur = session.duration_s;

  // 5 Hz clock (useNow 200 ms): feeds numbers, notices and audio only. All on-screen motion runs on
  // Animated values (native driver), so React never re-renders per frame.
  const nowMs = running ? now : startedAt ? startedAt + dur * 1000 : Date.now();
  const a = carState(moves, 0, startedAt, dur, nowMs, 'ui');
  const b = carState(moves, 1, startedAt, dur, nowMs, 'ui');

  // Engine sound from the user's recording. `side` = the car this device follows; viewers hear both equally.
  const LEVELS = [0, 0.5, 0.8, 1] as const;
  const [level, setLevel] = useState(3);
  const muted = LEVELS[level] === 0;
  const audio = useRaceAudio({ 0: { v: a.v, boost: a.boost, brake: a.brake }, 1: { v: b.v, boost: b.boost, brake: b.brake } },
    running && !muted, LEVELS[level], side);

  const canPay = (cost: number) => coins === null || coins >= cost;
  const gain = (kind: MoveKind) => kind === 'gas' ? `+${STEP.gas} m/s` : `−${STEP.brake} m/s`;
  /** Unlimited pedals: no cooldown, no lock; each tap is its own idempotent paid move. Balance is the only limit. */
  const doMove = async (targetSide: 0 | 1, kind: MoveKind) => {
    if (!running) return;
    if (!canPay(MOVE_COST[kind])) { notify('Not enough coins', `A ${kind === 'gas' ? 'gas' : 'brake'} pedal costs 🪙 ${MOVE_COST[kind]}.`); return; }
    if (kind === 'gas') audio.rev(targetSide);
    try {
      const r = await gameMove(session.id, targetSide, kind);
      void refreshWallet();
      if (r.coins === 0) notify('Balance empty', 'Recharge to keep playing.');
    } catch (e) { notify(kind === 'gas' ? 'Gas pedal failed' : 'Brake pedal failed', friendlyError(e)); }
  };

  // Stable handler so the memoised pedals never re-render because doMove is recreated.
  const moveRef = useRef(doMove); moveRef.current = doMove;
  const onMove = useCallback((t: 0 | 1, k: MoveKind) => { void moveRef.current(t, k); }, []);

  // Game messages: plain text only, one at a time in NoticeTicker.
  const noticeItems = useMemo(() => moves.map((m) => ({
    id: m.action_id,
    at: Date.parse(m.created_at),
    text: `${m.kind === 'gas' ? '⛽ Gas' : '🛑 Brake'} ${gain(m.kind)} · ${(m.side as 0 | 1) === 0 ? 'blue' : 'green'} car · 🪙 ${m.coins}`,
  })), [moves]); // eslint-disable-line react-hooks/exhaustive-deps

  const storedBg = useLiveBg();
  const bgImg = bgSource(bg ?? storedBg);

  /** One pedal column per player, outside the road on that player's side. */
  const pedalCol = (sd: 0 | 1) => {
    const mineCol = isPlayer && side === sd;
    const enabled = running && (!isPlayer || mineCol);
    const rival = (1 - sd) as 0 | 1;
    return (
      <View style={[st.pedals, sd === 0 ? { left: 4 } : { right: 4 }]} pointerEvents="box-none">
        <Text style={[st.pedalOwner, { color: sd === 0 ? BLUE : AMBER }]} numberOfLines={1}>{mineCol ? 'YOU' : nameOf(sd === 0 ? h : o)}</Text>
        <Pedal kind="gas" color="#22c55e" enabled={enabled} sub={gain('gas')} target={sd} onMove={onMove} />
        <Pedal kind="brake" color="#FF3B30" enabled={enabled} sub={gain('brake')} target={rival} onMove={onMove} />
      </View>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
        {bgImg != null && <Image source={bgImg} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />}
      </View>
      <VsCard game={session} h={h} o={o} hs={a.d} os={b.d} me={me} left={session.status === 'active' ? (startsIn ? dur : left) : 0} />

      <View style={st.arena} pointerEvents="box-none">
        <RaceTrack moves={moves} startedAt={startedAt} dur={dur} running={running} />

        <View style={st.arenaTop} pointerEvents="box-none">
          <Pressable accessibilityLabel="Engine sound volume" onPress={() => setLevel((l) => (l + 1) % LEVELS.length)} style={st.volBtn}>
            <Icon name={muted ? 'mute' : 'volume'} size={15} color="#fff" />
            <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end' }}>
              {[1, 2, 3].map((i) => <View key={i} style={{ width: 3, height: 4 + i * 3, borderRadius: 1, backgroundColor: i <= level ? '#fff' : 'rgba(255,255,255,0.25)' }} />)}
            </View>
          </Pressable>
          <View style={{ flex: 1 }} />
          {coins !== null && <View style={st.coinPill}><Text style={st.coinT}>🪙 {formatCoins(coins)}</Text></View>}
        </View>

        {startsIn > 0 && session.status === 'active' && <Countdown n={startsIn} />}
        {session.status === 'active' && pedalCol(0)}
        {session.status === 'active' && pedalCol(1)}
        {running && <NoticeTicker items={noticeItems} />}
      </View>

      {session.status === 'finished' && <ResultOverlay game={session} h={h} o={o} me={me} coins={coins} onClose={onDone} />}
    </View>
  );
});

/** Vertical pedal: fixed size, no press-scale or pulse. Never locks. */
const Pedal = memo(function Pedal({ kind, color, enabled, sub, target, onMove }: { kind: MoveKind; color: string; enabled: boolean; sub: string; target: 0 | 1; onMove: (t: 0 | 1, k: MoveKind) => void }) {
  return (
    <Pressable accessibilityLabel={`${kind === 'gas' ? 'Gas pedal' : 'Brake pedal'} · ${MOVE_COST[kind]} coins`} disabled={!enabled} onPress={() => onMove(target, kind)}
      style={({ pressed }) => [st.pedal, { borderColor: color, opacity: enabled ? 1 : 0.35 }, pressed && enabled && { backgroundColor: color + '55' }]}>
      <Text style={st.pedalIc}>{kind === 'gas' ? '⛽' : '🛑'}</Text>
      <Text style={st.pedalT}>{kind === 'gas' ? 'GAS' : 'BRAKE'}</Text>
      <View style={st.pedalBar}><View style={[st.pedalFill, { height: '100%', backgroundColor: color }]} /></View>
      <Text style={st.pedalSub}>{sub}</Text>
      <View style={[st.pedalCost, { backgroundColor: color }]}><Text style={st.pedalCostT}>🪙 {MOVE_COST[kind]}</Text></View>
    </Pressable>
  );
});

/** One message at a time (max 2 lines), fade + slide. Holds 3 s only when nothing waits; otherwise hands off fast. */
const NoticeTicker = memo(function NoticeTicker({ items }: { items: { id: string; at: number; text: string }[] }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [cur, setCur] = useState<{ id: string; text: string } | null>(null);
  const r = useRef({ seen: new Set<string>(), queue: [] as { id: string; text: string }[], showing: false, hiding: false, shownAt: 0, timer: null as ReturnType<typeof setTimeout> | null, mountAt: Date.now() });

  const hide = useCallback(() => {
    const s = r.current;
    if (s.hiding) return;
    s.hiding = true;
    Animated.timing(anim, { toValue: 0, duration: s.queue.length ? 160 : 320, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      s.hiding = false;
      const next = s.queue.shift();
      if (next) show(next); else { s.showing = false; setCur(null); }
    });
  }, [anim]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback(() => {
    const s = r.current;
    if (!s.showing || s.hiding) return;
    if (s.timer) clearTimeout(s.timer);
    const hold = s.queue.length ? 700 : 3000;
    s.timer = setTimeout(hide, Math.max(0, s.shownAt + 240 + hold - Date.now()));
  }, [hide]);

  const show = useCallback((n: { id: string; text: string }) => {
    const s = r.current;
    s.showing = true; s.shownAt = Date.now();
    setCur(n);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    schedule();
  }, [anim, schedule]);

  useEffect(() => {
    const s = r.current;
    let added = false;
    for (const it of items) {
      if (s.seen.has(it.id)) continue;
      s.seen.add(it.id);
      if (it.at < s.mountAt - 4000) continue;
      s.queue.push({ id: it.id, text: it.text }); added = true;
    }
    if (s.queue.length > 4) s.queue.splice(0, s.queue.length - 4);
    if (!added) return;
    if (!s.showing) { const n = s.queue.shift(); if (n) show(n); } else schedule();
  }, [items, show, schedule]);

  useEffect(() => () => { const t = r.current.timer; if (t) clearTimeout(t); }, []);

  if (!cur) return null;
  return (
    <Animated.View pointerEvents="none" testID="game-notice" style={[st.ticker, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    }]}>
      <Text style={st.tickerT} numberOfLines={2}>{cur.text}</Text>
    </Animated.View>
  );
});

/** 1:1 competitor tile. Behaves like a seat: live camera (unless switched off), mute badge, speaking ring, and a tap opens the same seat controls. */
const Tile = memo(function Tile({ p, uid, me, color, lead }: { p?: MiniProfile; uid: string; me: string; color: string; lead: boolean }) {
  const track = useVideoOf()(uid);
  const ctl = useTileCtl();
  const info = ctl.info(uid);
  const showVideo = !!track && !info?.camOff;
  return (
    <Pressable accessibilityLabel={`${nameOf(p)} seat`} onPress={() => ctl.press(uid)} style={[st.tile, { borderColor: info?.speaking && !info.muted ? '#34D399' : color }]}>
      {showVideo ? <LiveVideo track={track} mirror={uid === me} />
        : p?.avatar_url ? <Image source={{ uri: p.avatar_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        : <View style={[StyleSheet.absoluteFill, st.tileEmpty]}><Text style={st.tileInit}>{nameOf(p).slice(0, 1).toUpperCase()}</Text></View>}
      {info?.muted && <View style={st.tileMute}><Icon name="micOff" size={10} /></View>}
      <View style={st.tileFoot}><Text style={st.tileName} numberOfLines={1}>{lead ? '👑 ' : ''}{nameOf(p)}</Text></View>
    </Pressable>
  );
});

const VsCard = memo(function VsCard({ game, h, o, hs, os, left, me }: { game: GameSession; h?: MiniProfile; o?: MiniProfile; hs: number; os: number; left: number; me: string }) {
  const total = game.host_support + game.opp_support;
  const share = total ? game.host_support / total : 0.5;
  return (
    <View style={st.vs} testID="vs-card">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Tile p={h} uid={game.host_id} me={me} color={BLUE} lead={hs > os} />
        <View style={st.vsMid}>
          <View style={st.vsScores}>
            <Text style={[st.vsScore, { color: BLUE }]}>{Math.round(hs)} m</Text>
            <Text style={[st.vsScore, { color: AMBER }]}>{Math.round(os)} m</Text>
          </View>
          <Text style={st.vsMark}>VS</Text>
          <Text style={st.vsTime}>⏱ {mmss(left)}</Text>
          <Text style={st.vsPot}>🪙 {formatCoins(game.stake * 2)}</Text>
          <Text style={st.vsSup} numberOfLines={1}>📣 {formatCoins(game.host_support)} · {formatCoins(game.opp_support)}</Text>
        </View>
        <Tile p={o} uid={game.opponent_id} me={me} color={AMBER} lead={os > hs} />
      </View>
      <View style={st.supBar}><View style={{ flex: share, backgroundColor: BLUE }} /><View style={{ flex: 1 - share, backgroundColor: AMBER }} /></View>
    </View>
  );
});

// Same artwork; weak phones decode a 112 px copy (≈ 1/3 of the pixels) — it is drawn only 46 × 66 dp.
const CAR_PNG = LOW
  ? [require('../../../assets/games/car-racing/car_1_s.png'), require('../../../assets/games/car-racing/car_2_s.png')]
  : [require('../../../assets/games/car-racing/car_1.png'), require('../../../assets/games/car-racing/car_2.png')];

const CAR_H = 66; // car image height in px: the plume is anchored at its rear bumper
const SEG = 0.25; // s — one native-driven linear segment per motion update (~4 JS→native updates/s)

/** Vertical road. The race is evaluated here, every segment, from the move list and the SERVER clock
 *  (not from React state sampled at 5 Hz), then passed through `stepView` so a late or batched supporter
 *  move can never throw a car across the track. Road flow, car positions and tilt are native-driven
 *  linear segments that each start where the previous one is — no setValue resets, no restarts. */
const RaceTrack = memo(function RaceTrack({ moves, startedAt, dur, running }: { moves: Move[]; startedAt: number | null; dur: number; running: boolean }) {
  const [hgt, setHgt] = useState(400);
  const [wid, setWid] = useState(360);
  const pools = useMemo(() => [createSmokePool(), createSmokePool()], []);
  const emitters = useRef([createEmitter(), createEmitter()]).current;
  const puffPx = smokeSize(wid);
  const geo = useRef({ hgt, puffPx });
  geo.current = { hgt, puffPx };
  const yA = useRef(new Animated.Value(0.5)).current;
  const yB = useRef(new Animated.Value(0.5)).current;
  const road = useRef(new Animated.Value(0)).current;
  const roadMod = useMemo(() => Animated.modulo(road, 64), [road]); // dash period = 64 px → seamless loop
  const roadAcc = useRef(0);
  const t0 = useRef(new Animated.Value(0)).current;
  const t1 = useRef(new Animated.Value(0)).current;
  const tilt = useMemo(() => [t0, t1], [t0, t1]);

  const scale = Math.max(60, 0.3 * baselineDistance(Math.max(dur, 1)));
  const feed = useRef({ moves, startedAt, dur, scale });
  feed.current = { moves, startedAt, dur, scale };
  const active = useAppActive();

  useEffect(() => {
    if (!running || !active) return undefined;
    const minDt = LOW ? 1 / 30 : 0;
    const views = [{ d: 0, v: 0 }, { d: 0, v: 0 }];
    const sm = { ia: 0, ib: 0, syA: 0.5, syB: 0.5, tA: 0.5, tB: 0.5, vA: 10, vB: 10, bA: false, bB: false };
    let primed = false;
    let raf = 0; let last = 0; let seg = SEG;
    const slice = (span: number) => ({ duration: span * 1000, easing: Easing.linear, useNativeDriver: true, isInteraction: false }) as const;

    const advance = (span: number) => {
      const f = feed.current; const now = serverNow();
      const ex = [carState(f.moves, 0, f.startedAt, f.dur, now, 'frame'), carState(f.moves, 1, f.startedAt, f.dur, now, 'frame')];
      if (!primed) views.forEach((v, i) => { v.d = ex[i].d; v.v = ex[i].v; });
      else views.forEach((v, i) => stepView(v, ex[i].d, ex[i].v, span));
      sm.vA = views[0].v; sm.vB = views[1].v; sm.bA = ex[0].boost; sm.bB = ex[1].boost;
      // Where the cars will be one segment from now, at the speed they have now.
      const lead = leadOffset(views[0].d + views[0].v * span, views[1].d + views[1].v * span, f.scale);
      sm.tA = 0.5 - lead; sm.tB = 0.5 + lead;
      const want = (v: number, boost: boolean) => Math.min(1, Math.max(0, (v - 10) / 18) + (boost ? 0.45 : 0));
      const tiltA = Math.max(-1, Math.min(1, (want(sm.vA, sm.bA) - 0.5) * 1.4));
      const tiltB = Math.max(-1, Math.min(1, (want(sm.vB, sm.bB) - 0.5) * 1.4));
      roadAcc.current += ((views[0].v + views[1].v) / 2) * ROAD_PX_PER_M * span;
      if (!primed) {
        primed = true; sm.syA = sm.tA; sm.syB = sm.tB;
        yA.setValue(sm.tA); yB.setValue(sm.tB); road.setValue(roadAcc.current); t0.setValue(tiltA); t1.setValue(tiltB);
        return;
      }
      Animated.timing(yA, { toValue: sm.tA, ...slice(span) }).start();
      Animated.timing(yB, { toValue: sm.tB, ...slice(span) }).start();
      Animated.timing(road, { toValue: roadAcc.current, ...slice(span) }).start();
      Animated.timing(t0, { toValue: tiltA, ...slice(span) }).start();
      Animated.timing(t1, { toValue: tiltB, ...slice(span) }).start();
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!last) { last = t; return; }
      const dt = Math.min((t - last) / 1000, 0.1);
      if (dt < minDt) return;
      last = t;
      observeFrame(dt * 1000);
      seg += dt;
      if (seg >= SEG) { advance(Math.min(seg, 0.5)); seg = 0; }
      if (!primed) return;
      const kp = 1 - Math.exp(-dt / 0.35);
      sm.syA += (sm.tA - sm.syA) * kp;
      sm.syB += (sm.tB - sm.syB) * kp;
      const { hgt: h, puffPx: size } = geo.current;
      for (const side of [0, 1] as const) {
        const em = emitters[side];
        const drive = smokeDrive(em, side === 0 ? sm.vA : sm.vB, side === 0 ? sm.bA : sm.bB, dt);
        // Rear bumper in px: car box top is y·h − 40 and the image is CAR_H tall.
        const rear = (side === 0 ? sm.syA : sm.syB) * h - 40 + CAR_H - 6;
        stepSmoke(pools[side], em, dt * 1000, { drive, x: 0, y: rear, h, size });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); [yA, yB, road, t0, t1].forEach((v) => v.stopAnimation()); };
  }, [running, active, pools, emitters, road, tilt, yA, yB, t0, t1]);

  const ty = (v: Animated.Value) => v.interpolate({ inputRange: [-0.2, 1.2], outputRange: [-0.2 * hgt, 1.2 * hgt] });
  const rot = (v: Animated.Value) => v.interpolate({ inputRange: [-1, 0, 1], outputRange: ['1.2deg', '0deg', '-1.2deg'] });
  const dashes = useMemo(() => Array.from({ length: Math.ceil(hgt / 64) + 4 }, (_, i) => i), [hgt]);

  const car = (side: 0 | 1, y: Animated.Value) => (
    <View style={[st.lane, side === 0 ? { left: 0 } : { right: 0 }]}>
      <SmokePlume pool={pools[side]} size={puffPx} />
      <Animated.View style={[st.car, { transform: [{ translateY: Animated.add(ty(y), -40) }, { rotate: rot(tilt[side]) }] }]}>
        <Image source={CAR_PNG[side]} style={st.carImg} resizeMode="contain" />
      </Animated.View>
    </View>
  );

  return (
    <View style={st.trackWrap} onLayout={(e) => { const l = e.nativeEvent.layout; setHgt(l.height); setWid(l.width); }} pointerEvents="none">
      <View style={st.track}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: roadMod }] }]}>
          {dashes.map((i) => <View key={i} style={[st.dash, { top: i * 64 - 192 }]} />)}
        </Animated.View>
        {car(0, yA)}
        {car(1, yB)}
      </View>
    </View>
  );
});

function Countdown({ n }: { n: number }) {
  return <View style={st.count} pointerEvents="none"><Text style={st.countT}>{n}</Text><Text style={st.sub}>Get ready…</Text></View>;
}

function ResultOverlay({ game, h, o, me, coins, onClose }: { game: GameSession; h?: MiniProfile; o?: MiniProfile; me: string; coins: number | null; onClose: () => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(a, { toValue: 1, useNativeDriver: true, friction: 5 }).start(); }, [a]);
  const draw = !game.winner_id;
  const w = game.winner_id === game.host_id ? h : o;
  const iWon = game.winner_id === me;
  const player = me === game.host_id || me === game.opponent_id;
  const confetti = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ i, x: (i * 53) % 100, c: ['#FFD700', OR, BLUE, AMBER, '#FF2D55'][i % 5] })), []);
  return (
    <View style={st.result}>
      {!draw && confetti.map((c) => <Animated.View key={c.i} style={[st.confetti, { left: `${c.x}%`, backgroundColor: c.c, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-40, 260 + (c.i % 5) * 40] }) }, { rotate: `${c.i * 40}deg` }] }]} />)}
      <Animated.View style={[st.resultCard, { transform: [{ scale: a }] }]}>
        <Text style={{ fontSize: 44 }}>{draw ? '🤝' : '🏆'}</Text>
        {!draw && <VipAvatar userId={game.winner_id} uri={w?.avatar_url} name={nameOf(w)} size={72} />}
        <Text style={[st.h, { fontSize: 20, marginTop: 8 }]}>{draw ? "It's a draw!" : `${nameOf(w)} wins!`}</Text>
        <Text style={st.sub}>{game.result === 'forfeit' ? 'Opponent left the game' : `${Math.floor(game.host_score)} m  vs  ${Math.floor(game.opp_score)} m`}</Text>
        <View style={st.stakeBox}>
          <Text style={st.stakeT}>{draw ? `🪙 ${formatCoins(game.stake)} refunded` : `+🪙 ${formatCoins(game.payout)}`}</Text>
          {player && <Text style={st.sub}>{iWon ? 'Added to your wallet' : draw ? 'Stakes returned to both players' : 'Better luck next time'}{coins !== null ? ` · balance 🪙 ${formatCoins(coins)}` : ''}</Text>}
        </View>
        <Pressable onPress={onClose} style={[st.btn, { backgroundColor: OR, alignSelf: 'stretch', marginTop: 14 }]}><Text style={[st.btnT, { color: '#000' }]}>Back to live</Text></Pressable>
      </Animated.View>
    </View>
  );
}

/** Current user id helper for the global invite listener. */
export function useMyId(session: unknown) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void myId().then(setId).catch(() => setId(null)); }, [session]);
  return id;
}

const st = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', backgroundColor: '#14141a', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  h: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  warn: { color: '#FF6B6B', fontSize: 12, marginTop: 6, fontWeight: '700' },
  iconBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchIn: { flex: 1, color: '#fff', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { borderColor: OR, backgroundColor: 'rgba(255,165,0,0.08)' },
  name: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeT: { color: '#fff', fontSize: 9, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  chipIn: { width: 80, color: '#fff', fontSize: 12, textAlign: 'center' },
  chipOn: { backgroundColor: OR, borderColor: OR },
  chipT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  btn: { height: 46, borderRadius: 99, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  btnT: { color: '#fff', fontWeight: '900', fontSize: 14 },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: OR, alignItems: 'center', justifyContent: 'center' },
  ringT: { color: OR, fontSize: 22, fontWeight: '900' },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  invite: { width: '100%', maxWidth: 360, alignItems: 'center', backgroundColor: '#17171f', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,165,0,0.4)', overflow: 'hidden' },
  inviteGlow: { position: 'absolute', top: -80, width: 240, height: 160, borderRadius: 120, backgroundColor: 'rgba(255,165,0,0.18)' },
  stakeBox: { alignItems: 'center', marginTop: 12, backgroundColor: 'rgba(255,215,0,0.08)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'stretch' },
  stakeT: { color: '#FFD700', fontSize: 20, fontWeight: '900' },
  bar: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 12, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: OR },
  vs: { marginHorizontal: 6, marginTop: 66, padding: 6, borderRadius: 18, backgroundColor: 'rgba(12,12,20,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', zIndex: 15 },
  vsSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  vsAv: { borderWidth: 2, borderRadius: 24, padding: 1 },
  vsName: { color: '#fff', fontSize: 11, fontWeight: '800' },
  vsScore: { fontSize: 15, fontWeight: '900' },
  vsSup: { color: 'rgba(255,255,255,0.6)', fontSize: 9 },
  vsMark: { color: '#FF2D55', fontSize: 22, fontWeight: '900', fontStyle: 'italic', textShadowColor: 'rgba(255,45,85,0.6)', textShadowRadius: 8 },
  vsTime: { color: '#fff', fontSize: 11, fontWeight: '800' },
  vsPot: { color: '#FFD700', fontSize: 10, fontWeight: '800' },
  supBar: { flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  arena: { flex: 1, marginTop: 6 },
  track: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, marginHorizontal: '19%', backgroundColor: '#282830', borderLeftWidth: 3, borderRightWidth: 3, borderColor: '#fff', overflow: 'hidden' },
  dash: { position: 'absolute', top: 0, left: '50%', marginLeft: -2, width: 4, height: 30, backgroundColor: 'rgba(255,255,255,0.7)' },
  lane: { position: 'absolute', top: 0, bottom: 0, width: '50%', alignItems: 'center' },
  car: { position: 'absolute', top: 0, alignItems: 'center', width: 80 },
  carBody: { width: 34, height: 56, borderRadius: 10, alignItems: 'center', paddingTop: 10, borderWidth: 2, borderColor: 'rgba(0,0,0,0.3)' },
  carGlass: { width: 22, height: 14, borderRadius: 4, backgroundColor: '#bfe9ff' },
  count: { position: 'absolute', top: '25%', alignSelf: 'center', alignItems: 'center' },
  countT: { color: '#fff', fontSize: 72, fontWeight: '900', textShadowColor: OR, textShadowRadius: 16 },
  gas: { position: 'absolute', right: 10, top: '18%', width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', zIndex: 30 },
  gasT: { color: '#000', fontSize: 20, fontWeight: '900' },
  gasS: { color: '#000', fontSize: 9, fontWeight: '700' },
  supportRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', zIndex: 30 },
  support: { width: '48%', alignItems: 'center', padding: 6, borderRadius: 12, borderWidth: 1.5, backgroundColor: 'rgba(0,0,0,0.55)' },
  supportT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  result: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 },
  resultCard: { width: '100%', maxWidth: 340, alignItems: 'center', backgroundColor: '#17171f', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)' },
  confetti: { position: 'absolute', top: 0, width: 8, height: 14, borderRadius: 2 },
  trackWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  arenaTop: { position: 'absolute', top: 6, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', zIndex: 30 },
  volBtn: { height: 32, paddingHorizontal: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  muteBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  coinPill: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,215,0,0.5)' },
  coinT: { color: '#FFD700', fontSize: 11, fontWeight: '900' },
  feed: { position: 'absolute', bottom: 8, left: 10, right: 10, gap: 2, zIndex: 25 },
  feedRow: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  controls: { position: 'absolute', bottom: 76, left: 10, right: 10, flexDirection: 'row', justifyContent: 'space-between', gap: 10, zIndex: 40 },
  ctrl: { flex: 1, minHeight: 62, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, overflow: 'hidden' },
  ctrlT: { fontSize: 13, fontWeight: '900' },
  ctrlSub: { color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '700', marginTop: 2 },
  ctrlS: { width: 74, height: 50, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ctrlST: { fontSize: 17, fontWeight: '900' },
  cdBar: { position: 'absolute', bottom: 0, left: 0, height: 3 },
  viewerBar: { position: 'absolute', bottom: 76, left: 8, right: 8, flexDirection: 'row', gap: 8, zIndex: 40 },
  viewerCol: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 14, padding: 6, backgroundColor: 'rgba(0,0,0,0.45)', gap: 6, alignItems: 'center' },
  viewerName: { color: '#fff', fontSize: 10, fontWeight: '800', maxWidth: '100%' },
  prog: { position: 'absolute', top: 6, left: 8, right: 8, gap: 4 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progLbl: { fontSize: 9, fontWeight: '900', width: 54 },
  progTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  progFill: { height: 6, borderRadius: 3 },
  progM: { color: '#fff', fontSize: 9, fontWeight: '800', width: 44, textAlign: 'right' },
  edge: { position: 'absolute', top: 0, bottom: 0, width: 4, backgroundColor: 'rgba(255,255,255,0.85)' },
  carImg: { width: 46, height: 66 },
  ticker: { position: 'absolute', left: '20%', right: '20%', bottom: 336, alignItems: 'center', zIndex: 35 },
  tickerT: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(10,10,16,0.62)' },
  tile: { width: '31%', aspectRatio: 1, borderRadius: 12, borderWidth: 2, overflow: 'hidden', backgroundColor: '#111' },
  tileEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#222' },
  tileInit: { color: '#fff', fontSize: 34, fontWeight: '900' },
  tileMute: { position: 'absolute', right: 4, top: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  tileFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: 'rgba(0,0,0,0.55)' },
  tileName: { color: '#fff', fontSize: 10, fontWeight: '800' },
  vsMid: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  vsScores: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  pedals: { position: 'absolute', top: 48, width: '17%', alignItems: 'center', gap: 8, zIndex: 40 },
  pedalOwner: { fontSize: 9, fontWeight: '900', maxWidth: '100%' },
  pedal: { width: '100%', maxWidth: 62, height: 128, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 4, backgroundColor: 'rgba(0,0,0,0.55)', overflow: 'hidden' },
  pedalIc: { fontSize: 16 },
  pedalT: { color: '#fff', fontSize: 9, fontWeight: '900' },
  pedalBar: { width: 12, height: 34, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'flex-end', overflow: 'hidden' },
  pedalFill: { width: '100%', borderRadius: 6 },
  pedalSub: { color: 'rgba(255,255,255,0.85)', fontSize: 8, fontWeight: '800' },
  pedalCost: { borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 },
  pedalCostT: { color: '#000', fontSize: 10, fontWeight: '900' },
  notices: { position: 'absolute', left: '19%', right: '19%', bottom: 270, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(10,10,16,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', zIndex: 35 },
});
