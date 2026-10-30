import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { dismissNotice, getNotice, subscribeNotice, type Notice } from '../lib/netStatus';
import { MSG_OFFLINE, MSG_WEAK } from '../lib/errors';

/** App-wide thin top banner (mounted once at the root). Tap or swipe to dismiss for this outage. */
export function NetworkBanner() {
  const [n, setN] = useState<Notice>(getNotice());
  useEffect(() => subscribeNotice(setN), []);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12,
    onPanResponderRelease: (_e, g) => { if (Math.abs(g.dx) > 30 || g.dy < -20) dismissNotice(); },
  })).current;
  if (!n) return null;
  const label = n.kind === 'back' ? 'Back online' : n.kind === 'weak' ? MSG_WEAK : MSG_OFFLINE;
  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <Pressable testID="network-banner" accessibilityRole="button" accessibilityLabel={`${label}. Tap to dismiss`} onPress={dismissNotice} {...pan.panHandlers}
        style={[s.b, n.kind === 'back' ? s.back : n.kind === 'weak' ? s.slow : s.off]}>
        <Text style={s.t} numberOfLines={1}>{label}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center', zIndex: 999, elevation: 999 },
  b: { borderRadius: 14, paddingVertical: 4, paddingHorizontal: 14, maxWidth: '90%' },
  off: { backgroundColor: 'rgba(229,57,53,0.92)' },
  slow: { backgroundColor: 'rgba(230,140,0,0.92)' },
  back: { backgroundColor: 'rgba(46,160,67,0.92)' },
  t: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' },
});
