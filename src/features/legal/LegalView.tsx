// Reader for the Terms of Service and Privacy Policy. Used by the Auth consent box and the About page.
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/Icons';
import { LEGAL, type LegalKind } from './legalContent';

const O = '#FFA500';

export function LegalView({ kind }: { kind: LegalKind }) {
  const doc = LEGAL[kind];
  return (
    <View>
      <View style={s.hero}>
        <View style={s.heroIc}><Icon name={kind === 'terms' ? 'check' : 'lock'} size={22} color="#000" /></View>
        <Text style={s.title}>{doc.title}</Text>
        <Text style={s.tag}>{doc.tagline}</Text>
        <Text style={s.date}>Last updated: {doc.updated}</Text>
      </View>

      <View style={s.glance}>
        <Text style={s.glanceH}>The short version</Text>
        {doc.highlights.map((h) => (
          <View key={h} style={s.hi}><Text style={s.hiDot}>✓</Text><Text style={s.hiT}>{h}</Text></View>
        ))}
        <Text style={s.note}>This summary is only a guide. The full text below is what applies.</Text>
      </View>

      {doc.intro.map((p) => <Text key={p} style={s.p}>{p}</Text>)}

      {doc.sections.map((sec, i) => (
        <View key={sec.title} style={s.sec}>
          <View style={s.secHead}>
            <View style={s.num}><Text style={s.numT}>{i + 1}</Text></View>
            <Text style={s.secT}>{sec.title}</Text>
          </View>
          {sec.paras?.map((p) => <Text key={p} style={s.p}>{p}</Text>)}
          {sec.bullets?.map((b) => (
            <View key={b} style={s.bl}><Text style={s.dot}>•</Text><Text style={s.blT}>{b}</Text></View>
          ))}
        </View>
      ))}
      <Text style={s.end}>Thank you for being part of the hive.</Text>
    </View>
  );
}

/** Full-screen reader opened from places that are not part of the profile menu (for example the sign-in form). */
export function LegalModal({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  return (
    <Modal visible={kind !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.modal}>
          <View style={s.bar}>
            <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={s.close}><Icon name="x" size={20} color="#fff" /></Pressable>
            <Text style={s.barT}>{kind ? LEGAL[kind].title : ''}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            {kind && <LegalView kind={kind} />}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center' },
  modal: { flex: 1, width: '100%', maxWidth: 430, backgroundColor: '#000' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  barT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hero: { alignItems: 'center', paddingVertical: 8 },
  heroIc: { width: 52, height: 52, borderRadius: 16, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  tag: { color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  date: { color: O, fontSize: 11, fontWeight: '700', marginTop: 10 },
  glance: { marginTop: 18, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,165,0,0.35)', backgroundColor: 'rgba(255,165,0,0.08)', gap: 8 },
  glanceH: { color: O, fontSize: 13, fontWeight: '800' },
  hi: { flexDirection: 'row', gap: 8 },
  hiDot: { color: '#22C55E', fontWeight: '900', fontSize: 13 },
  hiT: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19 },
  note: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 4 },
  p: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, lineHeight: 21, marginTop: 10 },
  sec: { marginTop: 22 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,165,0,0.18)', alignItems: 'center', justifyContent: 'center' },
  numT: { color: O, fontSize: 12, fontWeight: '800' },
  secT: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800' },
  bl: { flexDirection: 'row', gap: 8, marginTop: 8, paddingLeft: 4 },
  dot: { color: O, fontSize: 14, lineHeight: 21 },
  blT: { flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13.5, lineHeight: 21 },
  end: { color: 'rgba(255,255,255,0.4)', fontSize: 12, textAlign: 'center', marginTop: 32 },
});
