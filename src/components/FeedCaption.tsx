// Formatted caption clamped to 2 lines; "Read more..." only when it overflows (web FeedCaption).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RichTextView } from './RichText';

export function FeedCaption({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(0);
  const [clamped, setClamped] = useState(0);
  const overflow = full > clamped + 1;
  return (
    <Pressable accessibilityLabel="Caption" onPress={() => (overflow || open) && setOpen((o) => !o)}>
      <View>
        {/* Hidden unclamped copy used to measure the real height on web and Android. */}
        <View pointerEvents="none" style={s.ghost} onLayout={(e) => setFull(e.nativeEvent.layout.height)}>
          <RichTextView html={html} style={s.cap} />
        </View>
        <View onLayout={(e) => !open && setClamped(e.nativeEvent.layout.height)}>
          <RichTextView html={html} style={s.cap} numberOfLines={open ? undefined : 2} />
        </View>
      </View>
      {(overflow || open) && <Text style={s.more}>{open ? 'Show less' : 'Read more...'}</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  cap: { color: 'rgba(255,255,255,0.95)', fontSize: 14, lineHeight: 19 },
  ghost: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  more: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', marginTop: 2 },
});
