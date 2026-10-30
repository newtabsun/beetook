// The one gift picker used by every gift entry point (feed, profile, live seats and the live gift box).
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { GiftEmblem } from '../../components/GiftEmblem';
import { TIERS, formatGiftCount, useGiftCatalog, type GiftItem, type GiftTier } from '../../lib/gifts';
import { colors } from '../../theme';

const ORDER: GiftTier[] = [1, 2, 3, 4, 5];

export function GiftPicker({ onPick, selectedId, cols = 3 }: { onPick: (id: string) => void; selectedId?: string | null; cols?: number }) {
  const { gifts, loading, reload } = useGiftCatalog();
  if (!gifts.length) {
    return loading
      ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />
      : <Pressable accessibilityLabel="Reload gifts" onPress={reload} style={{ paddingVertical: 24, alignItems: 'center' }}><Text style={{ color: 'rgba(255,255,255,0.7)' }}>Could not load gifts · tap to retry</Text></Pressable>;
  }
  const width = `${100 / cols - 2.2}%` as const;
  return (
    <View style={{ gap: 12 }}>
      {ORDER.map((tier) => {
        const items = gifts.filter((g: GiftItem) => g.tier === tier);
        if (!items.length) return null;
        const t = TIERS[tier];
        return (
          <View key={tier}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.c2 }} />
              <Text style={{ color: t.c1, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>{t.label.toUpperCase()}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700' }}>🪙 {formatGiftCount(items[0].coins)} – {formatGiftCount(items[items.length - 1].coins)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {items.map((x) => {
                const on = selectedId === x.id;
                return (
                  <Pressable key={x.id} testID={`gift-${x.id}`} accessibilityLabel={`${x.name} ${x.coins} coins`} onPress={() => onPick(x.id)}
                    style={{ width, alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 14, borderWidth: on ? 2 : 1,
                      borderColor: on ? t.c1 : 'rgba(255,255,255,0.1)', backgroundColor: on ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)' }}>
                    <GiftEmblem gift={x} size={cols > 3 ? 40 : 46} />
                    <Text numberOfLines={1} style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{x.name}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '800' }}>🪙 {formatGiftCount(x.coins)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
