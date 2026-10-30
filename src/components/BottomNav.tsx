import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polygon, Circle } from 'react-native-svg';
import { useUnread } from '../lib/unread';
import { Badge } from './Badge';

export type Tab = 'home' | 'live' | 'post' | 'inbox' | 'profile';
const ACCENT = '#FFA500';
const MUTED = 'rgba(255,255,255,0.6)';

function Icon({ id, color }: { id: Tab; color: string }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      {id === 'home' && <Path {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />}
      {id === 'live' && (<><Circle {...p} cx={12} cy={12} r={2} /><Path {...p} d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></>)}
      {id === 'inbox' && <Path {...p} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
      {id === 'profile' && (<><Circle {...p} cx={12} cy={8} r={4} /><Path {...p} d="M4 21a8 8 0 0 1 16 0" /></>)}
    </Svg>
  );
}

const ITEMS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' }, { id: 'live', label: 'Live' }, { id: 'post', label: 'Create' },
  { id: 'inbox', label: 'Inbox' }, { id: 'profile', label: 'Profile' },
];

export function BottomNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const unread = useUnread();
  return (
    <View style={s.bar}>
      {ITEMS.map((it) => {
        if (it.id === 'post') {
          return (
            <Pressable key="post" accessibilityLabel="Create" onPress={() => onTab('post')} style={s.item}>
              <Svg width={44} height={40} viewBox="0 0 44 40">
                <Polygon points="11,1 33,1 43,20 33,39 11,39 1,20" fill="rgba(255,165,0,0.1)" stroke={MUTED} strokeWidth={2} />
                <Path d="M22 13v14M15 20h14" stroke={ACCENT} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </Pressable>
          );
        }
        const active = tab === it.id;
        return (
          <Pressable key={it.id} accessibilityLabel={it.label} onPress={() => onTab(it.id)} style={s.item}>
            <View>
              <Icon id={it.id} color={active ? ACCENT : MUTED} />
              {it.id === 'inbox' && <Badge count={unread.alerts + unread.messages} style={s.navBadge} />}
            </View>
            <Text style={[s.label, active && s.active]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.9)', paddingHorizontal: 8, paddingVertical: 6 },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  label: { fontSize: 10, fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
  active: { color: ACCENT, fontWeight: '700' },
  navBadge: { position: 'absolute', top: -5, right: -12, borderWidth: 1.5, borderColor: '#000' },
});
