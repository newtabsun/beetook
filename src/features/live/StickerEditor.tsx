// Host sheet for live stickers: ONE text sticker (5 label looks) and ONE image sticker (any picture/GIF from files).
// The sheet sits in the top part of the screen and the keyboard pushes it up (AppModal), so the typed text stays visible.
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { friendlyError } from '../../lib/errors';
import { uploadStickerImage, type LiveSticker } from '../../lib/api';
import { notify } from '../../lib/notify';
import { colors } from '../../theme';
import { StickerBody } from './LiveStickers';
import { TEXT_LOOKS, findImageSticker, findTextSticker } from './liveStickers';

const OR = colors.primary;

export function StickerEditor({ stickers, onChange, onClose }: { stickers: LiveSticker[]; onChange: (next: LiveSticker[]) => void; onClose: () => void }) {
  const text = findTextSticker(stickers);
  const image = findImageSticker(stickers);
  const [draft, setDraft] = useState(text?.text ?? '');
  const [look, setLook] = useState(text?.bg ?? 0);
  const [busy, setBusy] = useState(false);
  const trimmed = draft.trim();

  const saveText = () => {
    if (!trimmed) return;
    const next: LiveSticker = text ? { ...text, kind: 'text', text: trimmed, bg: look, hidden: false } : { id: Date.now(), kind: 'text', text: trimmed, bg: look, x: 25, y: 38, s: 1 };
    onChange(text ? stickers.map((q) => (q.id === text.id ? next : q)) : [...stickers, next]);
    onClose();
  };
  const removeText = () => { if (text) onChange(stickers.filter((q) => q.id !== text.id)); setDraft(''); };

  const pickImage = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      setBusy(true);
      const url = await uploadStickerImage(a.uri, a.mimeType, a.name);
      const next: LiveSticker = image ? { ...image, kind: 'image', url, text: '', hidden: false } : { id: Date.now() + 1, kind: 'image', text: '', url, x: 30, y: 22, s: 1 };
      onChange(image ? stickers.map((q) => (q.id === image.id ? next : q)) : [...stickers, next]);
      onClose();
    } catch (e) { notify('Could not use this image', friendlyError(e)); }
    setBusy(false);
  };
  const removeImage = () => { if (image) onChange(stickers.filter((q) => q.id !== image.id)); };
  /** A sticker the host took off the screen with × is still saved here; this puts it back on the live. */
  const showAgain = (id: number) => { onChange(stickers.map((q) => (q.id === id ? { ...q, hidden: false } : q))); onClose(); };

  return (
    <AppModal onRequestClose={onClose} animationType="fade">
      <Pressable accessibilityLabel="Close stickers" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View pointerEvents="box-none" style={s.wrap}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.h}>Stickers</Text>
            <Pressable accessibilityLabel="Close" onPress={onClose}><Text style={s.x}>✕</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <Text style={s.label}>Text sticker</Text>
            <View style={s.preview}>
              {trimmed ? <StickerBody st={{ id: 0, kind: 'text', text: trimmed, bg: look, x: 0, y: 0 }} /> : <Text style={s.hint}>Your text appears here</Text>}
            </View>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Type your sticker text" maxLength={30} autoFocus
              placeholderTextColor="rgba(255,255,255,0.4)" style={s.input} returnKeyType="done" onSubmitEditing={saveText} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.looks}>
              {TEXT_LOOKS.map((l, i) => (
                <Pressable key={l.name} accessibilityLabel={`Label ${l.name}`} onPress={() => setLook(i)} style={[s.look, look === i && s.lookOn]}>
                  <View style={[l.box, { paddingHorizontal: 10, paddingVertical: 4, borderWidth: l.box.borderWidth ? 2 : 0 }]}><Text style={[s.lookT, l.text]}>Aa</Text></View>
                </Pressable>
              ))}
            </ScrollView>
            <View style={s.row}>
              <Pressable disabled={!trimmed} onPress={saveText} style={[s.btn, { backgroundColor: OR, opacity: trimmed ? 1 : 0.4 }]}><Text style={[s.btnT, { color: '#000' }]}>{text ? 'Update text' : 'Add text'}</Text></Pressable>
              {text && <Pressable accessibilityLabel="Remove text sticker" onPress={removeText} style={[s.btn, s.btnDanger]}><Text numberOfLines={1} style={s.btnT}>Remove</Text></Pressable>}
            </View>
            {text?.hidden && <Pressable onPress={() => showAgain(text.id)} style={[s.btn, s.btnGhost, { alignSelf: 'stretch', marginTop: 8 }]}><Text numberOfLines={1} style={s.btnT}>Show on live screen</Text></Pressable>}

            <Text style={[s.label, { marginTop: 16 }]}>Image sticker</Text>
            <View style={s.row}>
              <View style={s.thumb}>
                {image?.url ? <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : <Text style={s.hint}>None</Text>}
              </View>
              <Pressable disabled={busy} onPress={() => void pickImage()} style={[s.btn, { backgroundColor: OR, opacity: busy ? 0.6 : 1 }]}>
                {busy ? <ActivityIndicator color="#000" /> : <Text style={[s.btnT, { color: '#000' }]}>{image ? 'Replace image' : 'Choose from files'}</Text>}
              </Pressable>
              {image && !busy && <Pressable accessibilityLabel="Remove image sticker" onPress={removeImage} style={[s.btn, s.btnDanger]}><Text numberOfLines={1} style={s.btnT}>Remove</Text></Pressable>}
            </View>
            {image?.hidden && <Pressable onPress={() => showAgain(image.id)} style={[s.btn, s.btnGhost, { alignSelf: 'stretch', marginTop: 8 }]}><Text numberOfLines={1} style={s.btnT}>Show on live screen</Text></Pressable>}
          </ScrollView>
        </View>
      </View>
    </AppModal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-start', paddingTop: 48, paddingHorizontal: 12, paddingBottom: 8 },
  card: { flexShrink: 1, backgroundColor: '#141416', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', padding: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  h: { color: '#fff', fontSize: 16, fontWeight: '900' },
  x: { color: 'rgba(255,255,255,0.6)', fontSize: 16, paddingHorizontal: 6 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', marginBottom: 6 },
  preview: { minHeight: 64, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 8, padding: 8 },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  input: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 15 },
  looks: { gap: 8, paddingVertical: 10 },
  look: { borderRadius: 14, borderWidth: 2, borderColor: 'transparent', padding: 4, backgroundColor: 'rgba(255,255,255,0.05)' },
  lookOn: { borderColor: OR },
  lookT: { fontSize: 16, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { flex: 1, minWidth: 0, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnGhost: { flex: 0, flexShrink: 0, minWidth: 92, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14 },
  btnDanger: { flex: 0, flexShrink: 0, minWidth: 92, backgroundColor: '#FF3B30', paddingHorizontal: 14 },
  btnT: { color: '#fff', fontWeight: '900', fontSize: 13 },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
