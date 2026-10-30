import { notify } from '../../lib/notify';
import { memo, useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../../theme';
import { Icon } from '../../components/Icons';
import { NOTE_COLORS, type Note, useNotes } from './useNotes';

const NoteCard = memo(function NoteCard({
  note, active, onEdit, onDelete,
}: { note: Note; active: boolean; onEdit: (n: Note) => void; onDelete: (id: number) => void }) {
  return (
    <Pressable onPress={() => onEdit(note)} style={[s.card, active && { borderColor: colors.primary }]}>
      <Text style={[s.cardText, { color: note.color }, note.bold && s.bold, note.underline && s.underline]}>{note.text}</Text>
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
  const [text, setText] = useState('');
  const [color, setColor] = useState<string>(NOTE_COLORS[0]);
  const [bold, setBold] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reset = useCallback(() => {
    setEditingId(null); setText(''); setBold(false); setUnderline(false); setColor(NOTE_COLORS[0]);
  }, []);

  const save = () => {
    if (!text.trim()) return notify('Write a note');
    upsert({ text: text.trim(), color, bold, underline }, editingId);
    reset();
  };

  const edit = useCallback((n: Note) => {
    setEditingId(n.id); setText(n.text); setColor(n.color); setBold(n.bold); setUnderline(n.underline);
  }, []);

  const del = useCallback((id: number) => {
    remove(id);
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
      <View style={s.toolbar}>
        <Pressable accessibilityLabel="Bold" onPress={() => setBold((b) => !b)} style={[s.tool, bold && s.toolOn]}>
          <Text style={[s.toolText, s.bold]}>B</Text>
        </Pressable>
        <Pressable accessibilityLabel="Underline" onPress={() => setUnderline((u) => !u)} style={[s.tool, underline && s.toolOn]}>
          <Text style={[s.toolText, s.underline]}>U</Text>
        </Pressable>
        {NOTE_COLORS.map((c) => (
          <Pressable key={c} accessibilityLabel={`Color ${c}`} onPress={() => setColor(c)}
            style={[s.swatch, { backgroundColor: c, borderColor: color === c ? '#fff' : 'transparent' }]} />
        ))}
      </View>
      <TextInput
        value={text} onChangeText={setText} multiline placeholder="Write your note here..." placeholderTextColor="rgba(255,255,255,0.3)"
        style={[s.input, { color }, bold && s.bold, underline && s.underline]}
      />
      <Pressable onPress={save} style={s.save}><Text style={s.saveText}>{editingId !== null ? 'Update' : 'Save'}</Text></Pressable>
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
        renderItem={({ item }) => <NoteCard note={item} active={item.id === editingId} onEdit={edit} onDelete={del} />}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.sheet },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  back: { color: '#fff', fontSize: 22 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  body: { paddingTop: 20 },
  editBanner: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,165,0,0.15)', borderRadius: 8, padding: 8, marginBottom: 8 },
  editText: { color: colors.primary, fontSize: 12 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 },
  tool: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  toolOn: { backgroundColor: 'rgba(255,165,0,0.35)' },
  toolText: { color: '#fff', fontSize: 15 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  input: { minHeight: 160, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)', padding: 12, fontSize: 14, textAlignVertical: 'top' },
  save: { marginTop: 12, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' },
  saveText: { color: '#000', fontWeight: '700' },
  count: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 20, marginBottom: 8 },
  empty: { color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', paddingVertical: 24 },
  row: { gap: 10, marginBottom: 10 },
  card: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
  cardText: { fontSize: 14 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  date: { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  trash: { fontSize: 12, opacity: 0.6 },
  bold: { fontWeight: '800' },
  underline: { textDecorationLine: 'underline' },
});
