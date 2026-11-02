// Port of web PostOptions.tsx: thumbnail, privacy, permissions, schedule (split by `part`).
import * as ImagePicker from 'expo-image-picker';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from '../../components/Icons';
import { richToPlain } from '../../components/RichText';
import { colors } from '../../theme';

export type Privacy = 'everyone' | 'friends' | 'only_me';
export interface PublishOptions {
  thumbnail: string | null; privacy: Privacy; download: boolean; comments: boolean; duet: boolean;
  ageRestricted: boolean; scheduleAt: string | null; partner: boolean;
}
export const DEFAULT_PUBLISH_OPTIONS: PublishOptions = {
  thumbnail: null, privacy: 'everyone', download: true, comments: true, duet: true, ageRestricted: false, scheduleAt: null, partner: true,
};
const PRIVACY: { key: Privacy; label: string }[] = [
  { key: 'everyone', label: 'Everyone' }, { key: 'friends', label: 'Friends/Followers' }, { key: 'only_me', label: 'Only me' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Parses "YYYY-MM-DD HH:mm" (local time). */
export function parseSchedule(v: string | null): number | null {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return Number.isNaN(t) ? null : t;
}
export function scheduleError(o: PublishOptions): string | null {
  if (!o.scheduleAt) return null;
  const t = parseSchedule(o.scheduleAt);
  if (t === null) return 'Use the format YYYY-MM-DD HH:mm';
  if (t <= Date.now()) return 'Schedule time must be in the future';
  return null;
}

function Toggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => set(!on)} style={s.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={{ flex: 1 }}><Text style={s.tl}>{label}</Text><Text style={s.th}>{hint}</Text></View>
      <View style={[s.track, on && { backgroundColor: colors.primary }]}><View style={[s.knob, { left: on ? 22 : 2 }]} /></View>
    </Pressable>
  );
}

/** Partner on/off for one post; shown right under the caption box. */
export function PartnerToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <View style={s.section}>
      <Toggle label="Partner" hint={on ? 'Viewers can join your partners from this post' : 'Partner is hidden on this post'} on={on} set={set} />
    </View>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={s.section}><Text style={s.sectionT}>{title}</Text>{children}</View>
);

function Line({ icon, text }: { icon: IconName; text: string }) {
  return <View style={s.line}><Icon name={icon} size={12} color="rgba(255,255,255,0.8)" /><Text style={s.lineT}>{text}</Text></View>;
}

export function PostOptionsPanel({ value, onChange, images, captionHtml, part = 'all' }: {
  part?: 'all' | 'cover' | 'audience'; value: PublishOptions; onChange: (v: PublishOptions) => void; images?: string[]; captionHtml: string;
}) {
  const set = <K extends keyof PublishOptions>(k: K, v: PublishOptions[K]) => onChange({ ...value, [k]: v });
  const [preview, setPreview] = useState(false);
  const [more, setMore] = useState(part !== 'audience');
  const cv = part !== 'audience', au = part !== 'cover';
  const cover = value.thumbnail ?? images?.[0] ?? null;
  const pickCover = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!r.canceled) set('thumbnail', r.assets[0].uri);
  };
  const err = scheduleError(value);

  return (
    <View style={{ gap: 12 }}>
      {cv && <Section title="THUMBNAIL">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={s.thumbBox}>
            {value.thumbnail ? <Image source={{ uri: value.thumbnail }} style={s.fill} /> : <Text style={s.thumbT}>Default cover</Text>}
          </View>
          <View style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
            <Pressable onPress={() => void pickCover()} style={s.smallOutline}><Text style={s.smallOutlineT}>Choose from gallery</Text></Pressable>
            {value.thumbnail && <Pressable onPress={() => set('thumbnail', null)}><Text style={s.reset}>Reset to default</Text></Pressable>}
          </View>
        </View>
        {images && images.length > 1 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {images.map((u) => (
              <Pressable key={u} onPress={() => set('thumbnail', u)} style={[s.mini, value.thumbnail === u && { borderColor: colors.primary }]}>
                <Image source={{ uri: u }} style={s.fill} />
              </Pressable>
            ))}
          </View>
        )}
      </Section>}

      {au && <Section title="WHO CAN VIEW">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PRIVACY.map((p) => (
            <Pressable key={p.key} onPress={() => set('privacy', p.key)} style={[s.priv, value.privacy === p.key && { backgroundColor: colors.primary }]}>
              <Text style={[s.privT, value.privacy === p.key && { color: '#000' }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>}

      {au && part === 'audience' && <Pressable onPress={() => setMore(!more)} style={s.smallOutline}><Text style={s.smallOutlineT}>{more ? 'Hide more options' : 'More options'}</Text></Pressable>}
      {au && more && <Section title="PERMISSIONS">
        <Toggle label="Allow downloads" hint="Others can download this post" on={value.download} set={(v) => set('download', v)} />
        <Toggle label="Allow comments" hint="Others can comment" on={value.comments} set={(v) => set('comments', v)} />
        <Toggle label="Allow Duet/Share" hint="Others can duet and share" on={value.duet} set={(v) => set('duet', v)} />
        <Toggle label="18+ only" hint="Hidden from users under 18" on={value.ageRestricted} set={(v) => set('ageRestricted', v)} />
      </Section>}

      {au && <Section title="SCHEDULE">
        <Toggle label="Post later" hint="Publishes at the chosen date and time" on={!!value.scheduleAt}
          set={(v) => set('scheduleAt', v ? fmt(new Date(Date.now() + 3600_000)) : null)} />
        {value.scheduleAt !== null && (
          <>
            <TextInput value={value.scheduleAt} onChangeText={(v) => set('scheduleAt', v)} placeholder="YYYY-MM-DD HH:mm"
              placeholderTextColor="rgba(255,255,255,0.4)" style={[s.input, { marginTop: 4 }]} />
            {err && <Text style={s.err}>{err}</Text>}
          </>
        )}
      </Section>}

      {part === 'all' && <Pressable onPress={() => setPreview((p) => !p)} style={s.smallOutline}><Text style={s.smallOutlineT}>{preview ? 'Close preview' : 'Preview'}</Text></Pressable>}
      {part === 'all' && preview && (
        <View style={s.preview}>
          <View style={s.pvThumb}>{cover && <Image source={{ uri: cover }} style={s.fill} />}</View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: '#fff', fontSize: 14 }} numberOfLines={3}>{richToPlain(captionHtml) || '—'}</Text>
            <Line icon="eye" text={PRIVACY.find((p) => p.key === value.privacy)?.label ?? ''} />
            <Line icon="download" text={`Download: ${value.download ? 'allowed' : 'off'}`} />
            <Line icon="comment" text={`Comments ${value.comments ? 'on' : 'off'}`} />
            {value.ageRestricted && <Line icon="shield" text="18+" />}
            <Line icon="clock" text={value.scheduleAt ? value.scheduleAt : 'Now'} />
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', padding: 16 },
  sectionT: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  tl: { color: '#fff', fontSize: 14, fontWeight: '700' },
  th: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  track: { width: 44, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  knob: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  thumbBox: { width: 80, height: 112, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbT: { color: 'rgba(255,255,255,0.4)', fontSize: 10, textAlign: 'center' },
  fill: { width: '100%', height: '100%' },
  smallOutline: { height: 38, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  smallOutlineT: { color: '#fff', fontSize: 13, fontWeight: '700' },
  reset: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  mini: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  priv: { flex: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 4, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
  privT: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  input: { height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, color: '#fff', fontSize: 14 },
  err: { color: '#FF6B6B', fontSize: 12, marginTop: 6 },
  preview: { flexDirection: 'row', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,165,0,0.4)', backgroundColor: 'rgba(255,255,255,0.03)', padding: 12 },
  pvThumb: { width: 96, height: 128, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineT: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
});
