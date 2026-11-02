import { friendlyError } from '../../lib/errors';
// Port of Shell.tsx PostSteps: Edit → Details → Review, draft save, schedule, simulated posting.
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { PostMedia } from '../editor/PostMedia';
import { OverlayEditor } from './OverlayEditor';
import { colors } from '../../theme';
import type { PostDraft } from './usePosts';
import { Icon } from '../../components/Icons';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { notify } from '../../lib/notify';
import { DEFAULT_PUBLISH_OPTIONS, parseSchedule, PartnerToggle, PostOptionsPanel, scheduleError } from './PostOptions';

const STEPS = ['Edit', 'Details', 'Review'] as const;


export type PostMode = 'upload' | 'record' | 'photo';

export function PostFlowScreen({ mode = 'upload', initial, drafts, onPost, onDraft, onDeleteDraft, onClose, onRetake }: {
  mode?: PostMode;
  onRetake?: () => void;
  initial?: Pick<PostDraft, 'kind' | 'sources' | 'edit'>;
  drafts: PostDraft[];
  onPost: (p: PostDraft, onProgress?: (done: number, total: number) => void) => Promise<'scheduled' | 'posted'>;
  onDraft: (p: PostDraft) => Promise<void>;
  onDeleteDraft: (id: string) => Promise<void>;
  onClose: (posted?: string) => void;
}) {
  const [post, setPost] = useState<PostDraft | null>(initial ? { id: `p${Date.now()}`, caption: '', ...initial } : null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setFailed(null);
    try { await fn(); } catch (e) {
      const msg = friendlyError(e) || 'Upload failed. Check your connection and try again.';
      setFailed(msg);
      notify('Could not post', `${msg}\nYour post was saved to Drafts — tap "Try again" when you're back online.`);
    }
    setBusy(false); setProgress(null);
  };
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(!!initial);
  const { width } = useWindowDimensions();

  const pick = async (kind: PostDraft['kind'], camera = false) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { notify('Camera access is needed to record'); return; }
    }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 600, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'photos' ? ['images'] : ['videos'], allowsMultipleSelection: kind === 'photos', selectionLimit: 35, quality: 0.8,
      });
    if (r.canceled) return;
    setPost({ id: `p${Date.now()}`, kind, sources: r.assets.map((a) => a.uri), caption: post?.caption ?? '' });
    setStep(0);
    setEditing(true);
  };

  if (post && editing) {
    return (
      <OverlayEditor post={post} busy={busy} progress={progress}
        update={(fn) => setPost((p) => (p ? fn(p) : p))}
        onBack={() => (onRetake ? onRetake() : onClose())}
        onDraft={(scheduleAt) => void run(async () => { await onDraft({ ...post, scheduleAt }); notify('Draft saved'); onClose(); })}
        onPublish={(scheduleAt) => void run(async () => {
          const r = await onPost({ ...post, scheduleAt }, (d, t) => setProgress(Math.round((d / t) * 100)));
          onClose(r === 'scheduled' ? `Scheduled for ${new Date(scheduleAt!).toLocaleString()}` : 'Posted');
        })} />
    );
  }

  if (!post) {
    const isPhoto = mode === 'photo';
    const kindDrafts = drafts.filter((d) => (isPhoto ? d.kind === 'photos' : d.kind !== 'photos'));
    return (
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.pad}>
        <Header onClose={() => onClose()} title={isPhoto ? 'Photo post' : mode === 'record' ? 'New reel' : 'Upload video'} />
        <Pressable style={s.drop} onPress={() => void pick(isPhoto ? 'photos' : 'video', mode === 'record')}>
          <View style={s.dropIc}><Icon name={isPhoto ? 'image' : mode === 'record' ? 'camera' : 'video'} size={32} color="#000" /></View>
          <Text style={s.dropT}>{isPhoto ? 'Select photos' : mode === 'record' ? 'Record a video' : 'Select a video'}</Text>
          <Text style={s.muted}>{isPhoto ? 'Up to 35 photos · swipeable carousel' : 'MP4 or MOV · up to 10 minutes · 4K'}</Text>
        </Pressable>
        {kindDrafts.length > 0 && <Text style={s.section}>Drafts ({kindDrafts.length})</Text>}
        {kindDrafts.map((d) => (
          <View key={d.id} style={s.draft}>
            <Image source={{ uri: d.sources[0] }} style={s.thumb} />
            <Text style={s.draftT} numberOfLines={2}>{d.pending ? '⚠ Not uploaded · ' : ''}{d.caption || '(no caption)'}</Text>
            <Pressable onPress={() => { setPost(d); setStep(d.pending ? 2 : 1); }}><Text style={s.link}>{d.pending ? 'Retry' : 'Open'}</Text></Pressable>
            <Pressable onPress={() => void run(() => onDeleteDraft(d.id))}><Text style={[s.link, { color: '#E53935' }]}>Delete</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    );
  }

  const opts = post.options ?? DEFAULT_PUBLISH_OPTIONS;
  const schedErr = scheduleError(opts);
  const captionOk = post.caption.trim().length > 0 && !schedErr;
  const scheduleAt = parseSchedule(opts.scheduleAt) ?? undefined;
  const preview = <PostMedia kind={post.kind} sources={post.sources} edit={post.edit} width={width - 32} height={step === 2 ? 220 : 360} />;
  const saveDraft = () => run(async () => { await onDraft({ ...post, scheduleAt }); notify('Draft saved'); onClose(); });

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.pad}>
      <Header onClose={() => onClose()} title={post.kind === 'photos' ? 'Photo post' : 'Reel'} />
      <View style={s.steps}>
        {STEPS.map((l, i) => (
          <View key={l} style={s.stepRow}>
            <View style={[s.dot, i <= step && { backgroundColor: colors.primary }]}>{i < step ? <Icon name="check" size={13} color="#000" strokeWidth={3} /> : <Text style={[s.dotT, i <= step && { color: '#000' }]}>{i + 1}</Text>}</View>
            <Text style={[s.stepL, i === step && { color: '#fff' }]}>{l}</Text>
          </View>
        ))}
      </View>
      {step === 0 && (<>{preview}
        {post.kind === 'photos' && <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} horizontal data={post.sources} keyExtractor={(u) => u} renderItem={({ item }) => <Image source={{ uri: item }} style={s.thumb} />} />}
        <Pressable style={s.outline} onPress={() => setEditing(true)}><Text style={s.outlineT}>{post.kind === 'photos' ? 'Edit photos' : 'Edit video'}</Text></Pressable>
        <Pressable onPress={() => pick(post.kind)}><Text style={s.change}>Change {post.kind === 'photos' ? 'photos' : 'video'}</Text></Pressable></>)}
      {step === 1 && (<>
        <RichTextInput label="Caption" multiline value={post.captionHtml ?? post.caption} placeholder="Write a caption… #tags"
          onChange={(h) => setPost({ ...post, captionHtml: h, caption: richToPlain(h) })} />
        <PartnerToggle on={opts.partner} set={(v) => setPost({ ...post, options: { ...opts, partner: v } })} />
        <PostOptionsPanel value={opts} onChange={(o) => setPost({ ...post, options: o })} captionHtml={post.captionHtml ?? post.caption}
          images={post.kind === 'photos' ? post.sources : undefined} />
        {!post.caption.trim() && <Text style={s.muted}>Add a caption to continue.</Text>}</>)}
      {step === 2 && (<>{preview}
        <View style={s.review}>
          <Text style={s.muted}>CAPTION</Text><RichTextView html={post.captionHtml ?? post.caption} style={{ color: '#fff' }} numberOfLines={3} />
          <Text style={s.muted}>{post.kind === 'photos' ? `${post.sources.length} photo(s)` : 'Original reel'} · {scheduleAt ? `scheduled ${new Date(scheduleAt).toLocaleString()}` : 'posts now'}</Text>
        </View>
        <Pressable disabled={!captionOk || busy} style={[s.primary, (!captionOk || busy) && { opacity: 0.4 }]} onPress={() => void run(async () => {
          const r = await onPost({ ...post, scheduleAt }, (d, t) => setProgress(Math.round((d / t) * 100)));
          onClose(r === 'scheduled' ? `Scheduled for ${new Date(scheduleAt!).toLocaleString()}` : 'Posted');
        })}>{busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryT}>{failed ? 'Try again' : scheduleAt ? 'Schedule post' : 'Post'}</Text>}</Pressable>
        {!!failed && !busy && <Text testID="post-error" style={{ color: '#E53935', textAlign: 'center', fontSize: 12 }}>Upload failed: {failed}. Saved to Drafts.</Text>}
        {progress !== null && (
          <View style={{ gap: 6 }}>
            <View style={s.track}><View style={[s.fill, { width: `${progress}%` }]} /></View>
            <Text style={[s.muted, { textAlign: 'center' }]}>Uploading… {progress}%</Text>
          </View>
        )}</>)}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {step > 0 && <Pressable style={[s.outline, { flex: 1 }]} onPress={() => setStep(step - 1)}><Text style={s.outlineT}>Back</Text></Pressable>}
        {step < 2 && <Pressable disabled={step === 1 && !captionOk} style={[s.primary, { flex: 1 }, step === 1 && !captionOk && { opacity: 0.4 }]} onPress={() => setStep(step + 1)}><Text style={s.primaryT}>Next</Text></Pressable>}
      </View>
      <Pressable style={s.outline} disabled={busy} onPress={() => void saveDraft()}><Text style={s.outlineT}>Save as draft</Text></Pressable>
    </ScrollView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={s.head}>
      <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={s.close}><Icon name="x" size={16} /></Pressable>
      <Text style={s.title}>{title}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  title: { color: '#fff', fontWeight: '700', fontSize: 14 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  drop: { height: 380, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  dropIc: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dropT: { color: '#fff', fontWeight: '900', fontSize: 16 },
  primary: { backgroundColor: colors.primary, borderRadius: 99, padding: 13, alignItems: 'center' },
  primaryT: { color: '#000', fontWeight: '900' },
  outline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 99, padding: 13, alignItems: 'center' },
  outlineT: { color: '#fff', fontWeight: '700' },
  section: { color: 'rgba(255,255,255,0.6)', fontWeight: '800', marginTop: 6 },
  draft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  draftT: { flex: 1, color: '#fff' },
  thumb: { width: 56, height: 56, borderRadius: 8, marginRight: 6 },
  link: { color: colors.primary, fontWeight: '800' },
  steps: { flexDirection: 'row', justifyContent: 'space-between' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  dotT: { color: 'rgba(255,255,255,0.5)', fontWeight: '900', fontSize: 11 },
  stepL: { color: 'rgba(255,255,255,0.45)', fontWeight: '700' },
  change: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontWeight: '700' },
  videoBox: { borderRadius: 16, backgroundColor: '#1c1c1c', alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 14, padding: 12, minHeight: 110, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)' },
  chipT: { color: '#fff', fontWeight: '700' },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
  review: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 12, gap: 4 },
});
