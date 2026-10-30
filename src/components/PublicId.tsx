import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, type TextStyle } from 'react-native';

/** Database-issued numeric public ID (profiles.public_id), tap to copy. */
export function PublicId({ p, style }: { p: { public_id?: number | string | null }; style?: TextStyle }) {
  const [copied, setCopied] = useState(false);
  if (p.public_id == null) return null;
  const id = String(p.public_id);
  return (
    <Pressable accessibilityLabel="Copy ID" hitSlop={8} onPress={() => { void Clipboard.setStringAsync(id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      <Text style={[{ color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center', marginTop: 2 }, style]}>{copied ? 'ID copied ✓' : `ID: ${id}  ⧉`}</Text>
    </Pressable>
  );
}
