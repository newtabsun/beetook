// Car Racing — React Native port of the web game (public/games/car-racing.html):
// two-lane drag race, gas (-10) / brake (-5) coins, deposits, timed race, leader banner,
// finish results and restart. Same simulation constants; driven by requestAnimationFrame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatCoins, useWallet } from '../../lib/wallet';
import { Icon } from '../../components/Icons';

type Car = { name: string; color: string; roof: string; speed: number; target: number; top: number; distance: number; gas: number; brake: number; y: number };
const IDLE = 8;
const MAX = 230;
const newCar = (name: string, color: string, roof: string): Car => ({ name, color, roof, speed: IDLE, target: IDLE, top: IDLE, distance: 0, gas: 100, brake: 50, y: 0 });
const DURATIONS = [2, 4, 8, 12];
const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function CarRacingScreen({ onClose }: { onClose: () => void }) {
  const { coins } = useWallet();
  const [, tick] = useState(0);
  const [phase, setPhase] = useState<'setup' | 'race' | 'done'>('setup');
  const [minutes, setMinutes] = useState(2);
  const [custom, setCustom] = useState('');
  const [wager, setWager] = useState('100');
  const [names, setNames] = useState(['', '']);
  const [deposit, setDeposit] = useState<null | { key: 'gas' | 'brake'; p: 0 | 1; amt: string }>(null);
  const [notice, setNotice] = useState('');
  const [size, setSize] = useState({ w: 360, h: 420 });
  const g = useRef({ p: [newCar('PLAYER 1', '#06b6d4', '#0284c7'), newCar('PLAYER 2', '#f59e0b', '#d97706')], time: 120, pot: 0, road: 0, running: false, skids: [] as { x: number; y: number; life: number }[] });

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(t); }, [notice]);

  const endRace = useCallback(() => { g.current.running = false; setPhase('done'); }, []);

  useEffect(() => {
    let raf = 0; let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      const s = g.current;
      if (s.running) {
        s.time = Math.max(0, s.time - dt);
        if (s.time <= 0) endRace();
        const [a, b] = s.p;
        for (const c of s.p) {
          if (c.target > IDLE) c.target = Math.max(IDLE, c.target - 12 * dt);
          c.speed += (c.target - c.speed) * Math.min(1, dt * 5);
          c.top = Math.max(c.top, c.speed);
          c.distance += (c.speed * dt) / 3600;
        }
        const step = Math.max(a.speed, b.speed, IDLE) * 0.18 * dt * 60;
        s.road = (s.road + step) % 60;
        s.skids = s.skids.map((k) => ({ ...k, y: k.y + step, life: k.life - 0.015 })).filter((k) => k.life > 0);
        const H = size.h; const span = H * 0.3;
        const shift = Math.tanh(((a.distance - b.distance) * 1000) / 30) * span * 0.75 + ((a.speed - b.speed) / MAX) * span * 0.25;
        const clamp = (v: number) => Math.max(H * 0.18, Math.min(H - 85, v));
        const lerp = 1 - Math.exp(-dt * 3.2);
        a.y += (clamp(H * 0.58 - shift) - a.y) * lerp;
        b.y += (clamp(H * 0.58 + shift) - b.y) * lerp;
        tick((n) => (n + 1) % 1e6);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [endRace, size.h]);

  const road = Math.min(Math.max(size.w * 0.68, 210), 320);
  const left = (size.w - road) / 2;
  const laneX = (i: number) => left + (road / 2) * (i + 0.5);

  const press = (i: 0 | 1, kind: 'gas' | 'brake') => {
    const s = g.current; if (!s.running) return;
    const c = s.p[i];
    if (kind === 'gas' && c.gas >= 10) { c.gas -= 10; c.target = Math.min(c.target + 26, MAX); }
    if (kind === 'brake' && c.brake >= 5) { c.brake -= 5; c.target = Math.max(IDLE, c.target - 35); s.skids.push({ x: laneX(i), y: c.y + 22, life: 1 }); }
  };

  const start = () => {
    const mins = minutes === 0 ? Math.max(2, parseInt(custom, 10) || 2) : minutes;
    const w = Math.max(0, parseInt(wager, 10) || 0);
    if (coins !== null && w * 2 > coins) return setNotice('Not enough coins for this stake');
    const s = g.current;
    s.p = [newCar((names[0].trim() || 'PLAYER 1').toUpperCase(), '#06b6d4', '#0284c7'), newCar((names[1].trim() || 'PLAYER 2').toUpperCase(), '#f59e0b', '#d97706')];
    s.p.forEach((c) => { c.y = size.h * 0.65; });
    s.time = mins * 60; s.pot = w * 2; s.skids = []; s.running = true;
    setPhase('race');
  };

  const confirmDeposit = () => {
    if (!deposit) return;
    const amt = parseInt(deposit.amt, 10);
    if (amt > 0) g.current.p[deposit.p][deposit.key] += amt;
    setDeposit(null);
  };

  const s = g.current; const [a, b] = s.p;
  const diff = a.distance - b.distance;
  const lead = phase !== 'race' ? 'RACE READY' : Math.abs(diff) < 0.002 ? 'DEAD HEAT (TIED)' : `LEADER: ${diff > 0 ? a.name : b.name} (+${Math.round(Math.abs(diff) * 1000)}M)`;
  const leadColor = phase !== 'race' || Math.abs(diff) < 0.002 ? '#d4d4d8' : diff > 0 ? '#67e8f9' : '#fcd34d';
  const winner = a.distance > b.distance ? a : b.distance > a.distance ? b : null;

  return (
    <View style={st.root}>
      <View style={st.head}>
        <Text style={st.headT}>🏎️ Car Racing · LIVE</Text>
        <Text style={st.coins}>🪙 {coins === null ? '…' : formatCoins(coins)}</Text>
        <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10}><Icon name="x" size={20} /></Pressable>
      </View>
      {!!notice && <Text style={st.notice}>{notice}</Text>}
      <View style={{ flex: 1 }}>

      <View style={st.hud}>
        <View style={st.hudTop}>
          <View style={st.pill}><Text style={st.pillL}>TIME:</Text><Text testID="race-timer" style={[st.timer, s.time <= 10 && phase === 'race' && { color: '#f43f5e' }]}>{fmt(phase === 'setup' ? (minutes || 2) * 60 : s.time)}</Text></View>
          <Text testID="lead-banner" numberOfLines={1} style={[st.lead, { color: leadColor }]}>{lead}</Text>
          <View style={[st.pill, { borderColor: 'rgba(245,158,11,0.4)' }]}><Text style={[st.pillL, { color: '#fbbf24' }]}>POT:</Text><Text style={st.pot}>{s.pot} 🪙</Text></View>
        </View>
        <View style={st.row2}>
          {s.p.map((c, i) => (
            <View key={i} style={[st.card, { borderColor: i ? 'rgba(245,158,11,0.3)' : 'rgba(6,182,212,0.3)' }]}>
              <View style={st.cardH}><Text numberOfLines={1} style={[st.cardN, { color: c.color }]}>● {c.name}</Text><Text style={[st.lane, { color: c.color }]}>LANE {i + 1}</Text></View>
              <View style={st.cardB}>
                <View><Text style={st.sm}>SPEED</Text><Text style={[st.speed, { color: c.color }]}>{Math.round(c.speed)} <Text style={st.sm}>KM/H</Text></Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={st.sm}>DISTANCE</Text><Text testID={`p${i + 1}-distance`} style={st.dist}>{c.distance.toFixed(3)} <Text style={[st.sm, { color: c.color }]}>KM</Text></Text></View>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={st.canvas} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <View style={[st.road, { left, width: road }]} />
        {Array.from({ length: Math.ceil(size.h / 60) + 2 }).map((_, k) => (
          <View key={k} style={[st.dash, { left: left + road / 2 - 2, top: k * 60 - 60 + s.road }]} />
        ))}
        {[left - 6, left + road].map((x, k) => Array.from({ length: Math.ceil(size.h / 30) + 2 }).map((_, j) => (
          <View key={`${k}-${j}`} style={{ position: 'absolute', left: x, width: 6, height: 30, top: j * 30 - 60 + ((s.road * 2) % 60), backgroundColor: j % 2 ? '#ef4444' : '#fafafa' }} />
        )))}
        {s.skids.map((k, i) => <View key={i} style={{ position: 'absolute', left: k.x - 14, top: k.y, width: 28, height: 18, opacity: k.life * 0.5, borderLeftWidth: 4, borderRightWidth: 4, borderColor: '#111' }} />)}
        {s.p.map((c, i) => (
          <View key={i} style={[st.car, { left: laneX(i) - 21, top: (c.y || size.h * 0.65) - 39, backgroundColor: c.color }]}>
            <View style={[st.roof, { backgroundColor: c.roof }]} />
            <View style={st.glass} />
          </View>
        ))}
      </View>

      <View style={st.foot}>
        {([0, 1] as const).map((i) => {
          const c = s.p[i];
          return (
            <View key={i} style={[st.ctrl, { borderColor: i ? 'rgba(120,53,15,0.6)' : 'rgba(22,78,99,0.6)' }]}>
              <Text style={[st.ctrlH, { color: c.color }]}>PLAYER {i + 1} CONTROLS</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['brake', 'gas'] as const).map((k) => (
                  <View key={k} style={st.btnCard}>
                    <View style={st.btnTop}><Text style={[st.sm, { color: k === 'gas' ? c.color : '#fb7185', fontWeight: '800' }]}>{k.toUpperCase()} {k === 'gas' ? '-10' : '-5'}</Text></View>
                    <View style={st.btnTop}>
                      <Pressable accessibilityLabel={`Deposit P${i + 1} ${k}`} onPress={() => setDeposit({ key: k, p: i, amt: '50' })} style={[st.plus, { backgroundColor: k === 'gas' ? c.color : '#e11d48' }]}><Text style={st.plusT}>+</Text></Pressable>
                      <Text style={[st.coinN, (k === 'gas' ? c.gas < 10 : c.brake < 5) && { color: '#fb7185' }]}>{c[k]}</Text>
                    </View>
                    <Pressable testID={`p${i + 1}-${k}`} accessibilityLabel={`Player ${i + 1} ${k}`} onPress={() => press(i, k)} style={({ pressed }) => [st.big, k === 'gas' ? { backgroundColor: c.color } : { borderWidth: 1, borderColor: '#f43f5e' }, pressed && { transform: [{ scale: 0.95 }] }]}>
                      <Text style={[st.bigT, k === 'brake' && { color: '#fb7185' }]}>{k === 'gas' ? '⚡ GAS' : '🛑 BRAKE'}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>

      {phase === 'setup' && (
        <View style={st.modalBg}>
          <ScrollView contentContainerStyle={st.modal}>
            <Text style={st.badge}>🏁 DUAL DRAG RACE CHAMPIONSHIP</Text>
            <Text style={st.h1}>SPEEDWAY DUEL</Text>
            <View style={st.box}>
              <Text style={st.boxH}>⏱️ MANDATORY RACE DURATION · MIN 2</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {[...DURATIONS, 0].map((m) => (
                  <Pressable key={m} onPress={() => setMinutes(m)} style={[st.dur, minutes === m && st.durOn]}><Text style={[st.durT, minutes === m && { color: '#fcd34d' }]}>{m ? `${m} MIN` : 'CUSTOM'}</Text></Pressable>
                ))}
              </View>
              {minutes === 0 && <TextInput value={custom} onChangeText={setCustom} placeholder="2" placeholderTextColor="#71717a" keyboardType="number-pad" style={st.input} />}
            </View>
            <View style={st.box}>
              <Text style={st.boxH}>🪙 COMPETITOR WAGER COINS · WINNER TAKES ALL</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput accessibilityLabel="Line 1 coin" value={wager} onChangeText={setWager} keyboardType="number-pad" style={[st.input, { flex: 1 }]} />
                <Text style={[st.input, { flex: 1, color: '#fcd34d' }]}>{wager || 0} (SYNC)</Text>
              </View>
              <Text style={st.sm}>TOTAL POT: {(parseInt(wager, 10) || 0) * 2}</Text>
            </View>
            <View style={st.box}>
              {[0, 1].map((i) => <TextInput key={i} value={names[i]} onChangeText={(t) => setNames((n) => n.map((x, j) => (j === i ? t : x)))} placeholder={`PLAYER ${i + 1} NAME`} placeholderTextColor="#71717a" style={[st.input, { marginBottom: 6 }]} />)}
            </View>
            <Pressable testID="start-race" onPress={start} style={st.startBtn}><Text style={st.startT}>🏎️ START RACE</Text></Pressable>
          </ScrollView>
        </View>
      )}

      {phase === 'done' && (
        <View style={st.modalBg}>
          <View style={st.modal}>
            <Text style={st.badge}>🏆 RACE FINISHED</Text>
            <Text testID="winner-text" style={[st.h1, { color: winner ? winner.color : '#fde047' }]}>{winner ? `${winner.name} WINS!` : "IT'S A DEAD TIE!"}</Text>
            <Text style={st.reward}>{winner ? `+${s.pot}` : `SPLIT ${s.pot / 2} EACH`}</Text>
            {s.p.map((c, i) => (
              <View key={i} style={[st.box, { flexDirection: 'row', justifyContent: 'space-between' }]}>
                <Text style={{ color: c.color, fontWeight: '800' }}>{c.name}</Text>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{c.distance.toFixed(3)} KM · TOP {Math.round(c.top)} KM/H</Text>
              </View>
            ))}
            <Pressable testID="restart-race" onPress={() => setPhase('setup')} style={st.startBtn}><Text style={st.startT}>🔁 NEW RACE</Text></Pressable>
          </View>
        </View>
      )}

      {deposit && (
        <View style={st.modalBg}>
          <View style={st.modal}>
            <Text style={[st.boxH, { fontSize: 14 }]}>DEPOSIT COINS</Text>
            <Text style={st.sm}>TARGET: PLAYER {deposit.p + 1} - {deposit.key.toUpperCase()}</Text>
            <TextInput value={deposit.amt} onChangeText={(t) => setDeposit({ ...deposit, amt: t })} keyboardType="number-pad" style={st.input} />
            <View style={{ flexDirection: 'row', gap: 6 }}>{[20, 50, 100, 200].map((q) => <Pressable key={q} onPress={() => setDeposit({ ...deposit, amt: String(q) })} style={st.dur}><Text style={st.durT}>+{q}</Text></Pressable>)}</View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setDeposit(null)} style={[st.startBtn, { flex: 1, backgroundColor: '#27272a' }]}><Text style={st.startT}>CANCEL</Text></Pressable>
              <Pressable onPress={confirmDeposit} style={[st.startBtn, { flex: 1, backgroundColor: '#10b981' }]}><Text style={st.startT}>CONFIRM</Text></Pressable>
            </View>
          </View>
        </View>
      )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#09090b' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#000' },
  headT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  coins: { color: '#FFA500', fontSize: 12, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, overflow: 'hidden' },
  notice: { marginHorizontal: 16, marginBottom: 6, backgroundColor: '#FFA500', color: '#000', fontWeight: '800', textAlign: 'center', padding: 6, borderRadius: 8, fontSize: 12 },
  hud: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111113', borderBottomWidth: 1, borderColor: '#27272a' },
  hudTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#3f3f46', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  pillL: { color: '#a1a1aa', fontSize: 9, fontWeight: '800' },
  timer: { color: '#fbbf24', fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  pot: { color: '#fcd34d', fontSize: 11, fontWeight: '900' },
  lead: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '800', backgroundColor: '#27272a', borderRadius: 99, paddingVertical: 3, paddingHorizontal: 6, overflow: 'hidden' },
  row2: { flexDirection: 'row', gap: 6 },
  card: { flex: 1, padding: 6, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(24,24,27,0.8)' },
  cardH: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingBottom: 3 },
  cardN: { fontSize: 11, fontWeight: '800', flex: 1 },
  lane: { fontSize: 9, fontWeight: '800' },
  cardB: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  sm: { color: '#a1a1aa', fontSize: 9 },
  speed: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  dist: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  canvas: { flex: 1, overflow: 'hidden', backgroundColor: '#14532d' },
  road: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#27272a' },
  dash: { position: 'absolute', width: 4, height: 30, backgroundColor: '#facc15' },
  car: { position: 'absolute', width: 42, height: 78, borderRadius: 10, alignItems: 'center', paddingTop: 16 },
  roof: { width: 30, height: 34, borderRadius: 8 },
  glass: { position: 'absolute', top: 12, width: 28, height: 8, borderRadius: 3, backgroundColor: 'rgba(191,219,254,0.8)' },
  foot: { flexDirection: 'row', gap: 6, padding: 6, backgroundColor: '#000', borderTopWidth: 1, borderColor: '#27272a' },
  ctrl: { flex: 1, padding: 5, borderRadius: 14, borderWidth: 1, backgroundColor: '#18181b', gap: 4 },
  ctrlH: { fontSize: 9, fontWeight: '900' },
  btnCard: { flex: 1, backgroundColor: '#09090b', borderRadius: 10, padding: 4, gap: 3 },
  btnTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plus: { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  plusT: { color: '#fff', fontWeight: '900', fontSize: 12 },
  coinN: { color: '#fcd34d', fontSize: 11, fontWeight: '800' },
  big: { borderRadius: 8, paddingVertical: 9, alignItems: 'center', backgroundColor: '#18181b' },
  bigT: { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: '#18181b', borderRadius: 24, borderWidth: 1, borderColor: '#3f3f46', padding: 16, gap: 10 },
  badge: { alignSelf: 'center', color: '#22d3ee', fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: 'rgba(6,182,212,0.4)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  h1: { textAlign: 'center', color: '#fcd34d', fontSize: 22, fontWeight: '900', fontStyle: 'italic' },
  box: { backgroundColor: '#09090b', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', padding: 10, gap: 6 },
  boxH: { color: '#fbbf24', fontSize: 10, fontWeight: '900' },
  dur: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#27272a', alignItems: 'center' },
  durOn: { borderColor: '#fbbf24', backgroundColor: 'rgba(245,158,11,0.2)' },
  durT: { color: '#a1a1aa', fontSize: 10, fontWeight: '800' },
  input: { backgroundColor: '#27272a', borderRadius: 10, color: '#67e8f9', padding: 8, fontWeight: '800', textAlign: 'center' },
  startBtn: { backgroundColor: '#2563eb', borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  startT: { color: '#fff', fontWeight: '900', fontSize: 13 },
  reward: { textAlign: 'center', color: '#fde047', fontSize: 22, fontWeight: '900' },
});
