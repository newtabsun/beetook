// Card shown when someone without VIP and under 1,000 followers taps Go Live.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { Icon } from '../../components/Icons';
import { formatNum } from '../../lib/api';
import { LIVE_FREE_FOLLOWERS } from '../../lib/liveRule';

const O = '#FFA500';

export function LiveAccessCard({ followers, onClose }: { followers: number; onClose: () => void }) {
  const pct = Math.min(1, followers / LIVE_FREE_FOLLOWERS);
  return (
    <AppModal onRequestClose={onClose} animationType="fade">
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={() => undefined} accessibilityLabel="Go Live is locked">
          <View style={s.ic}><Icon name="radio" size={28} color="#000" /></View>
          <Text style={s.h}>Going live is locked</Text>
          <Text style={s.sub}>To go live you need one of these:</Text>

          <View style={s.opt}>
            <Icon name="crown" size={18} color="#FFD700" />
            <View style={{ flex: 1 }}>
              <Text style={s.optT}>Become a VIP member</Text>
              <Text style={s.optD}>Profile → Menu → VIP</Text>
            </View>
          </View>
          <Text style={s.or}>or</Text>
          <View style={s.opt}>
            <Icon name="users" size={18} color={O} />
            <View style={{ flex: 1 }}>
              <Text style={s.optT}>Reach {LIVE_FREE_FOLLOWERS.toLocaleString('en-US')} followers</Text>
              <View style={s.bar}><View style={[s.fill, { width: `${Math.max(2, pct * 100)}%` }]} /></View>
              <Text style={s.optD}>{formatNum(followers)} / {LIVE_FREE_FOLLOWERS.toLocaleString('en-US')} followers</Text>
            </View>
          </View>

          <Pressable accessibilityLabel="Got it" onPress={onClose} style={s.btn}><Text style={s.btnT}>Got it</Text></Pressable>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,165,0,0.4)', backgroundColor: '#0E0E10', padding: 20, gap: 10, alignItems: 'stretch' },
  ic: { alignSelf: 'center', width: 60, height: 60, borderRadius: 20, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  h: { color: '#fff', fontSize: 20, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center' },
  opt: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  optT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  optD: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  or: { color: 'rgba(255,255,255,0.4)', fontWeight: '800', textAlign: 'center', fontSize: 12 },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 8 },
  fill: { height: 6, borderRadius: 3, backgroundColor: O },
  btn: { marginTop: 8, height: 48, borderRadius: 14, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#000', fontWeight: '900', fontSize: 15 },
});
