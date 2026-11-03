import { notify } from '../../lib/notify';
import { memo, useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../../theme';
import { Icon } from '../../components/Icons';
import { RichTextInput, RichTextView, richToPlain, toHtml } from '../../components/RichText';
import { NOTE_COLORS, type Note, useNotes } from './useNotes';

/** Rich HTML of a note; older single-color notes are converted on the fly. */
const htmlOf = (n: Note) => n.html ?? toHtml([{ t: n.text, c: n.color, b: n.bold, u: n.underline }]);

const NoteCard = memo(function NoteCard({
  note, onOpen, onDelete,
}: { note: Note; onOpen: (n: Note) => void; onDelete: (id: number) => void }) {
  return (
    <Pressable onPress={() => onOpen(note)} style={s.card} accessibilityLabel="Open note">
      <RichTextView html={htmlOf(note)} style={s.cardText} numberOfLines={8} />
      <View style={s.cardFooter}>
        <Text style={s.date}>{new Date(note.at).toLocaleDateString()}</Text>
        <Pressable accessibilityLabel="Delete note" hitSlop={8} onPress={() => onDelete(note.id)}>
          <Icon name="trash" size={16} color="rgba(255,255,255,0.5)" />
        </Pressable>
      </View>
    </Pressable>
  );
});

export function NotesScreen({ onBack }: { onBack: () => void }) {
  const { notes, upsert, remove } = useNotes();
  const [html, setHtml] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);

  const reset = useCallback(() => {
    setEditingId(null); setHtml(''); setEditorKey((k) => k + 1);
  }, []);

  const save = () => {
    const text = richToPlain(html);
    if (!text) return notify('Write a note');
    upsert({ text, html, color: NOTE_COLORS[0], bold: false, underline: false }, editingId);
    reset();
  };

  const edit = useCallback((n: Note) => {
    setViewing(null);
    setEditingId(n.id); setHtml(htmlOf(n)); setEditorKey((k) => k + 1);
  }, []);

  const del = useCallback((id: number) => {
    remove(id);
    setViewing((cur) => (cur?.id === id ? null : cur));
    setEditingId((cur) => (cur === id ? null : cur));
  }, [remove]);

  const header = (
    <View style={s.body}>
      {editingId !== null && (
        <View style={s.editBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="note" size={14} color={colors.primary} /><Text style={s.editText}>Editing note</Text></View>
          <Pressable accessibilityLabel="Cancel editing" onPress={reset}><Icon name="x" size={16} color={colors.primary} /></Pressable>
        </View>
      )}
      <RichTextInput key={editorKey} freeColors multiline value={html} onChange={setHtml} placeholder="Write your note here..." label="Note" />
      <Pressable onPress={save} style={s.save} accessibilityLabel="Save note"><Text style={s.saveText}>{editingId !== null ? 'Update' : 'Save'}</Text></Pressable>
      <Text style={s.count}>Saved notes ({notes.length})</Text>
      {notes.length === 0 && <Text style={s.empty}>No notes yet</Text>}
    </View>
  );

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Pressable accessibilityLabel="Back" onPress={onBack} hitSlop={10}><Icon name="back" size={24} /></Pressable>
        <Text style={s.title}>Your note</Text>
      </View>
      <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        data={notes}
        keyExtractor={(n) => String(n.id)}
        numColumns={2}
        columnWrapperStyle={s.row}
        ListHeaderComponent={header}
        renderItem={({ item }) => <NoteCard note={item} onOpen={setViewing} onDelete={del} />}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
      />
      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={s.full} testID="note-fullscreen">
          <View style={s.fullTop}>
            <Pressable accessibilityLabel="Close note" onPress={() => setViewing(null)} hitSlop={10}><Icon name="x" size={24} /></Pressable>
            <Text style={s.fullDate}>{viewing ? new Date(viewing.at).toLocaleDateString() : ''}</Text>
            <Pressable accessibilityLabel="Edit note" onPress={() => viewing && edit(viewing)} hitSlop={10} style={s.editBtn}><Text style={s.editBtnT}>Edit</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={s.fullBody}>
            {viewing && <RichTextView html={htmlOf(viewing)} style={s.fullText} />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.sheet },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  body: { paddingTop: 20 },
  editBanner: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,165,0,0.15)', borderRadius: 8, padding: 8, marginBottom: 8 },
  editText: { color: colors.primary, fontSize: 12 },
  save: { marginTop: 10, alignSelf: 'flex-end', backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 18, alignItems: 'center' },
  saveText: { color: '#000', fontWeight: '700', fontSize: 12 },
  count: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 20, marginBottom: 8 },
  empty: { color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', paddingVertical: 24 },
  row: { gap: 10, marginBottom: 10 },
  card: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
  cardText: { fontSize: 14, color: '#FFFFFF' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  date: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  full: { flex: 1, backgroundColor: colors.sheet },
  fullTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  fullDate: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  editBtn: { backgroundColor: 'rgba(255,165,0,0.18)', borderRadius: radius.md, paddingVertical: 5, paddingHorizontal: 14 },
  editBtnT: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  fullBody: { padding: 20, paddingBottom: 60 },
  fullText: { fontSize: 18, lineHeight: 28, color: '#FFFFFF' },
});
