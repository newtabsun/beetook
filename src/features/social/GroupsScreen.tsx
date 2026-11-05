import { requireSignIn } from '../../lib/guest';
import { friendlyError } from '../../lib/errors';
// Groups parity with legacy web GroupsView: tabs, VIP create with photo/description/fees, paid join,
// realtime chat with photo + voice media, owner earnings and settings. Fees are charged server-side.
import { VipAvatar, VipTag } from '../../components/Vip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from '../../components/CachedImage';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule, RecordingPresets, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import {
  createGroup, fetchGroupEarnings, fetchGroupMessages, fetchGroups, myIdOrNull, sendGroupMessage, setGroupComments, setGroupMembership,
  subscribeTables, updateGroup, type Group, type GroupEarning, type GroupFeeKind, type GroupFees, type GroupMessage,
  nameHtmlOf, editGroupMessage, deleteGroupMessage, reactGroupMessage, myGroupReactions, groupReplies, groupUnread, markGroupRead,
  pinGroup, unpinGroup, findGroupUser, replaceGroupOwner, addGroupOwner, removeGroupOwner, deleteGroupOwner,
} from '../../lib/api';
import { T } from '../../lib/supabase';
import { colors } from '../../theme';
import { RichTextInput, RichTextView, richToPlain } from '../../components/RichText';
import { Icon } from '../../components/Icons';

const A = '#FFA500';
const PH = 'rgba(255,255,255,0.4)';
const FEE_LABEL: Record<keyof GroupFees, string> = { join: 'Joining fee', text: 'Text message', photo: 'Photo message', voice: 'Voice message' };
const DEFAULT_FEES: GroupFees = { join: 10, text: 1, photo: 3, voice: 5 };
const feesOf = (g: Group): GroupFees => ({ join: g.fee_join, text: g.fee_text, photo: g.fee_photo, voice: g.fee_voice });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
type Tab = 'all' | 'mine' | 'create';
type Screen = 'chat' | 'settings' | 'earnings';

function GroupAvatar({ photo, title, color, size }: { photo: string; title: string; color: string; size: number }) {
  const st = { width: size, height: size, borderRadius: size / 2 };
  if (photo) return <Image source={{ uri: photo }} style={st} accessibilityLabel={`${title} picture`} />;
  return <View style={[st, s.avFallback, { backgroundColor: color }]}><Text style={[s.avT, { fontSize: size * 0.4 }]}>{(title || 'G').charAt(0).toUpperCase()}</Text></View>;
}

async function pickImage(): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  return r.canceled ? null : r.assets[0].uri;
}

function PhotoPicker({ photo, title, color, onPick }: { photo: string; title: string; color: string; onPick: (u: string) => void }) {
  const pick = async () => { const u = await pickImage(); if (u) onPick(u); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable accessibilityLabel="Choose group picture from gallery" onPress={pick}>
        <GroupAvatar photo={photo} title={title} color={color} size={64} />
        <View style={s.camBadge}><Icon name="camera" size={12} color="#000" /></View>
      </Pressable>
      <View>
        <Pressable onPress={pick} style={s.chip}><Text style={s.chipT}>Choose from gallery</Text></Pressable>
        <Text style={s.hint}>JPG or PNG</Text>
      </View>
    </View>
  );
}

function FeeEditor({ fees, onChange }: { fees: GroupFees; onChange: (f: GroupFees) => void }) {
  return (
    <View style={s.feeBox}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="coin" size={14} color={A} /><Text style={s.label}>Coin fees you set</Text></View>
      {(Object.keys(FEE_LABEL) as (keyof GroupFees)[]).map((k) => (
        <View key={k} style={s.feeRow}>
          <Text style={s.feeT}>{FEE_LABEL[k]}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput accessibilityLabel={FEE_LABEL[k]} keyboardType="numeric" value={String(fees[k])}
              onChangeText={(v) => onChange({ ...fees, [k]: Math.max(0, Number(v.replace(/\D/g, '')) || 0) })} style={s.feeIn} />
            <Text style={{ color: A, fontSize: 12, fontWeight: '700' }}>coins</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function GroupForm({ initial, color, cta, onSubmit }: {
  initial: { title: string; description: string; photo: string; fees: GroupFees }; color: string; cta: string;
  onSubmit: (v: { title: string; description: string; photo: string; fees: GroupFees }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [desc, setDesc] = useState(initial.description);
  const [photo, setPhoto] = useState(initial.photo);
  const [fees, setFees] = useState(initial.fees);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!title.trim()) return setErr('Group title is required');
    setBusy(true); setErr('');
    try { await onSubmit({ title, description: desc, photo, fees }); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 16 }}>
      <View><Text style={s.label}>Profile picture</Text><View style={{ marginTop: 8 }}><PhotoPicker photo={photo} title={title} color={color} onPick={setPhoto} /></View></View>
      <View><Text style={s.label}>Title</Text><RichTextInput value={title} onChange={setTitle} placeholder="Group title" /></View>
      <View><Text style={s.label}>Description</Text><RichTextInput multiline value={desc} onChange={setDesc} placeholder="What is this group about?" /></View>
      <FeeEditor fees={fees} onChange={setFees} />
      {!!err && <Text style={s.err}>{err}</Text>}
      <Pressable style={[s.cta, busy && { opacity: 0.5 }]} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color="#000" /> : <><Icon name={cta === 'Save changes' ? 'check' : 'plus'} size={16} color="#000" /><Text style={s.ctaT}>{cta}</Text></>}
      </Pressable>
    </View>
  );
}

function VoiceNote({ uri, mine }: { uri: string; mine: boolean }) {
  const player = useAudioPlayer(uri);
  const [on, setOn] = useState(false);
  const toggle = () => { if (on) player.pause(); else { if (player.currentTime >= player.duration - 0.1) player.seekTo(0); player.play(); } setOn(!on); };
  return (
    <Pressable accessibilityLabel={on ? 'Pause voice note' : 'Play voice note'} onPress={toggle} style={s.voice}>
      <Icon name={on ? 'mute' : 'play'} size={16} color={mine ? '#000' : A} />
      <View style={[s.wave, { backgroundColor: mine ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.25)' }]} />
    </Pressable>
  );
}

function VoiceRecorder({ onRecorded }: { onRecorded: (uri: string, secs: number) => void }) {
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  const start = async () => {
    try {
      const p = await AudioModule.requestRecordingPermissionsAsync();
      if (!p.granted) return setErr('Microphone permission denied');
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record(); setSecs(0); setRecording(true); setErr('');
    } catch { setErr('Voice recording is not supported on this device'); }
  };
  const stop = async () => {
    await rec.stop(); setRecording(false);
    if (rec.uri) onRecorded(rec.uri, secs);
  };
  return (
    <View>
      <Pressable accessibilityLabel={recording ? 'Stop recording' : 'Record voice'} onPress={() => void (recording ? stop() : start())} style={recording ? s.recOn : s.iconBtn}>
        {recording ? <><View style={s.stopSq} /><Text style={s.recT}>{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</Text></> : <Icon name="mic" size={16} />}
      </Pressable>
      {!!err && <Text style={[s.err, { position: 'absolute', bottom: 44, width: 200 }]}>{err}</Text>}
    </View>
  );
}

/** Message body: stored HTML (new lines become <br>) or legacy plain text; line breaks are always preserved. */
const bodyHtml = (b: string) => (/<[a-z][^>]*>/i.test(b) ? b : b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));

/** Tiny action button with an optional counter (reply / like / dislike). */
function Act({ icon, n, on, onPress, label }: { icon: 'comment' | 'thumbs'; n: number; on?: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name={icon} size={13} color={on ? '#000' : 'rgba(255,255,255,0.7)'} flip={label === 'Dislike'} />
      {n > 0 && <Text style={{ color: on ? '#000' : 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800' }}>{n}</Text>}
    </Pressable>
  );
}

function GroupDetail({ group, me, onBack, onChanged }: { group: Group; me: string; onBack: () => void; onChanged: () => void }) {
  const owner = group.owner_id === me;
  const isOwnerish = owner || !!group.co_owners?.includes(me);
  const [screen, setScreen] = useState<Screen>('chat');
  const [msgs, setMsgs] = useState<GroupMessage[] | null>(null);
  const [earn, setEarn] = useState<GroupEarning[]>([]);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [mine, setMine] = useState<Record<number, 'like' | 'dislike'>>({});
  const [menuFor, setMenuFor] = useState<GroupMessage | null>(null);
  const [editing, setEditing] = useState<GroupMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [thread, setThread] = useState<GroupMessage | null>(null);
  const [replies, setReplies] = useState<GroupMessage[]>([]);
  const [replyDraft, setReplyDraft] = useState('');
  const scroll = useRef<FlatList<GroupMessage>>(null);

  const loadMsgs = useCallback(() => fetchGroupMessages(group.id).then((l) => {
    const tops = l.filter((m) => !m.reply_to); setMsgs(tops);
    void myGroupReactions(l.map((m) => m.id)).then(setMine).catch(() => undefined);
  }).catch((e: Error) => { setErr(friendlyError(e)); setMsgs([]); }), [group.id]);
  const loadEarn = useCallback(() => { if (owner) void fetchGroupEarnings(group.id).then(setEarn).catch(() => undefined); }, [group.id, owner]);
  const loadReplies = useCallback((p: GroupMessage) => groupReplies(p.id).then((r) => { setReplies(r); void myGroupReactions(r.map((x) => x.id)).then((m) => setMine((o) => ({ ...o, ...m }))).catch(() => undefined); }).catch(() => undefined), []);
  useEffect(() => { void loadMsgs(); loadEarn(); void markGroupRead(group.id); }, [loadMsgs, loadEarn, group.id]);
  useEffect(() => subscribeTables(`grp-${group.id}`, [{ table: T.groupMessages, filter: `group_id=eq.${group.id}` }], () => {
    void loadMsgs(); loadEarn(); void markGroupRead(group.id);
    if (thread) void loadReplies(thread);
  }), [group.id, loadMsgs, loadEarn, thread, loadReplies]);

  const send = async (kind: GroupFeeKind, body: string, media?: string, replyTo?: number | null) => {
    if (kind === 'text' && !body.trim()) return;
    setSending(true); setErr('');
    try {
      const fee = await sendGroupMessage(group.id, kind, kind === 'text' ? body : body.trim(), media, replyTo);
      if (kind === 'text') { if (replyTo) setReplyDraft(''); else setDraft(''); }
      setNote(fee > 0 ? `${fee} coins charged for ${FEE_LABEL[kind].toLowerCase()}` : '');
      await loadMsgs(); loadEarn(); if (thread) await loadReplies(thread);
    } catch (e) {
      const m = (e as Error).message;
      setErr(/insufficient/i.test(m) ? `Not enough coins — ${FEE_LABEL[kind]} is ${feesOf(group)[kind]} coins` : friendlyError(e));
    } finally { setSending(false); }
  };

  const react = async (m: GroupMessage, kind: 'like' | 'dislike') => {
    const prev = mine[m.id];
    const patch = (list: GroupMessage[]) => list.map((x) => {
      if (x.id !== m.id) return x;
      let l = x.like_count, d = x.dislike_count;
      if (prev === 'like') l -= 1; if (prev === 'dislike') d -= 1;
      if (prev !== kind) { if (kind === 'like') l += 1; else d += 1; }
      return { ...x, like_count: Math.max(0, l), dislike_count: Math.max(0, d) };
    });
    setMine((o) => { const n = { ...o }; if (prev === kind) delete n[m.id]; else n[m.id] = kind; return n; });
    setMsgs((l) => (l ? patch(l) : l)); setReplies((l) => patch(l));
    try { await reactGroupMessage(m.id, kind); } catch (e) { setErr(friendlyError(e)); void loadMsgs(); }
  };

  const doDelete = async (m: GroupMessage) => {
    setMenuFor(null);
    try { await deleteGroupMessage(m.id); setMsgs((l) => (l ? l.filter((x) => x.id !== m.id) : l)); setReplies((l) => l.filter((x) => x.id !== m.id)); if (thread?.id === m.id) setThread(null); }
    catch (e) { setErr(friendlyError(e)); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    setSending(true);
    try { await editGroupMessage(editing.id, editText); setEditing(null); await loadMsgs(); if (thread) await loadReplies(thread); }
    catch (e) { setErr(friendlyError(e)); }
    setSending(false);
  };

  const total = earn.reduce((a, e) => a + e.coins, 0);
  const byKind = (k: GroupFeeKind) => earn.filter((e) => e.kind === k).reduce((a, e) => a + e.coins, 0);

  const bubble = (m: GroupMessage, inThread: boolean) => {
    const own = m.user_id === me;
    const who = m.author?.display_name || m.author?.username || 'Member';
    const fg = own ? '#000' : '#fff';
    return (
      <View key={m.id} style={{ flexDirection: 'row', justifyContent: own ? 'flex-end' : 'flex-start', gap: 8 }}>
        {!own && <VipAvatar userId={m.user_id} uri={m.author?.avatar_url} name={who} size={s.mAv.width as number} color={A} />}
        <View style={own ? s.bMine : s.bOther}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {!own && <><RichTextView html={nameHtmlOf(m.author, 'Member')} style={s.author} numberOfLines={1} /><VipTag id={m.user_id} /></>}
            <View style={{ flex: 1 }} />
            {own && m.kind === 'text' && <Pressable accessibilityLabel="Message options" hitSlop={8} onPress={() => setMenuFor(m)}><Icon name="more" size={16} color="#000" /></Pressable>}
            {own && m.kind !== 'text' && <Pressable accessibilityLabel="Message options" hitSlop={8} onPress={() => setMenuFor(m)}><Icon name="more" size={16} color="#000" /></Pressable>}
          </View>
          {m.kind === 'photo' && !!m.media && <Image source={{ uri: m.media }} style={s.mImg} accessibilityLabel="Shared photo" />}
          {m.kind === 'voice' && !!m.media && <VoiceNote uri={m.media} mine={own} />}
          {!!m.body && <RichTextView html={bodyHtml(m.body)} style={{ color: fg, fontSize: 14 }} />}
          <Text style={[s.time, own && { color: 'rgba(0,0,0,0.6)', textAlign: 'right' }]}>{hhmm(m.created_at)}{m.edited_at ? ' · edited' : ''}{m.fee > 0 ? ` · ${m.fee} coins` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
            {!inThread && <Act icon="comment" n={m.reply_count} label="Reply" on={own} onPress={() => { setThread(m); void loadReplies(m); }} />}
            <Act icon="thumbs" n={m.like_count} label="Like" on={mine[m.id] === 'like' || (own && false)} onPress={() => void react(m, 'like')} />
            <Act icon="thumbs" n={m.dislike_count} label="Dislike" on={mine[m.id] === 'dislike'} onPress={() => void react(m, 'dislike')} />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={s.detail}>
      <View style={s.dHead}>
        <Pressable accessibilityLabel="Back" onPress={() => (screen === 'chat' ? onBack() : setScreen('chat'))} hitSlop={8}><Icon name="back" size={22} /></Pressable>
        <GroupAvatar photo={group.photo} title={richToPlain(group.name)} color={group.avatar_color} size={36} />
        <View style={{ flex: 1 }}><RichTextView html={group.name} style={s.name} numberOfLines={1} /><Text style={s.muted}>{group.member_count.toLocaleString('en-US')} members</Text></View>
        {isOwnerish && (
          <>
            {owner && <Pressable accessibilityLabel="Group earnings" hitSlop={6} onPress={() => { loadEarn(); setScreen('earnings'); }}><Icon name="trending" size={20} color={A} /></Pressable>}
            <Pressable accessibilityLabel="Group settings" hitSlop={6} onPress={() => setScreen('settings')}><Icon name="settings" size={20} /></Pressable>
          </>
        )}
      </View>

      {screen === 'chat' && (
        <>
          <FlatList ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
            data={msgs ?? []} keyExtractor={(m) => String(m.id)} initialNumToRender={15} windowSize={7}
            ListHeaderComponent={msgs === null ? <ActivityIndicator color={colors.primary} /> : null}
            ListEmptyComponent={msgs?.length === 0 ? <Text style={[s.muted, { textAlign: 'center', paddingVertical: 40, fontSize: 14 }]}>No messages yet — say hello 🐝</Text> : null}
            renderItem={({ item: m }) => bubble(m, false)} />
          <View style={s.composer}>
            {group.comments_enabled === false ? <Text testID="group-comments-off" style={[s.hint, { textAlign: 'center' }]}>Messages are turned off for this group</Text>
              : !group.joined && !isOwnerish ? <Text style={s.err}>Join the group to send messages.</Text> : (
              <>
                <Text style={s.hint}>{isOwnerish ? 'You are an owner — your messages are free.' : `Text ${group.fee_text} · Photo ${group.fee_photo} · Voice ${group.fee_voice} coins`}</Text>
                {!!note && <Text style={[s.hint, { color: A }]}>{note}</Text>}
                {!!err && <Text style={s.err}>{err}</Text>}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 }}>
                  <Pressable accessibilityLabel="Send photo" style={s.iconBtn} disabled={sending} onPress={async () => { const u = await pickImage(); if (u) void send('photo', '', u); }}><Icon name="image" size={16} /></Pressable>
                  <VoiceRecorder onRecorded={(u, secs) => void send('voice', `Voice note · 0:${String(secs).padStart(2, '0')}`, u)} />
                  <View style={{ flex: 1 }}><RichTextInput multiline label="Message group" value={draft} onChange={setDraft} placeholder="Message group…" sending={sending} onSend={() => void send('text', draft)} /></View>
                </View>
              </>
            )}
          </View>
        </>
      )}

      {screen === 'settings' && <OwnerSettings group={group} me={me} owner={owner} err={err} setErr={setErr} onChanged={onChanged} onClose={() => setScreen('chat')} onDeleted={onBack} />}

      {screen === 'earnings' && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View style={s.earnCard}>
            <Text style={s.earnL}>Total earnings</Text>
            <Text style={s.earnV}>{total.toLocaleString('en-US')} coins</Text>
            <Text style={{ color: 'rgba(0,0,0,0.8)', fontWeight: '700' }}>≈ {(total / 10).toLocaleString('en-US')} ETB</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['text', 'photo', 'voice'] as GroupFeeKind[]).map((k) => (
              <View key={k} style={s.kindBox}><Text style={s.muted}>{k}</Text><Text style={{ color: A, fontSize: 18, fontWeight: '900' }}>{byKind(k).toLocaleString('en-US')}</Text></View>
            ))}
          </View>
          <Text style={s.label}>Recent earnings</Text>
          {earn.length === 0 && <Text style={[s.muted, { textAlign: 'center' }]}>No earnings yet.</Text>}
          {earn.map((e) => (
            <View key={e.id} style={s.earnRow}>
              <View style={{ flex: 1 }}><Text style={s.name}>{e.from}</Text><Text style={s.muted}>{e.kind} · {hhmm(e.created_at)}</Text></View>
              <Text style={{ color: A, fontWeight: '900' }}>+{e.coins}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {menuFor && (
        <Pressable style={s.overlay} onPress={() => setMenuFor(null)}>
          <View style={s.menu}>
            {menuFor.kind === 'text' && <MenuBtn label="Edit" onPress={() => { setEditing(menuFor); setEditText(richToPlain(bodyHtml(menuFor.body))); setMenuFor(null); }} />}
            <MenuBtn label="Delete" danger onPress={() => void doDelete(menuFor)} />
            <MenuBtn label="Cancel" onPress={() => setMenuFor(null)} />
          </View>
        </Pressable>
      )}

      {editing && (
        <Pressable style={s.overlay} onPress={() => setEditing(null)}>
          <Pressable style={s.menu} onPress={() => undefined}>
            <Text style={s.name}>Edit message</Text>
            <TextInput multiline value={editText} onChangeText={setEditText} style={[s.input, { minHeight: 90, textAlignVertical: 'top', marginTop: 10 }]} accessibilityLabel="Edit message" />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable style={[s.outline, { flex: 1, alignItems: 'center' }]} onPress={() => setEditing(null)}><Text style={s.outlineT}>Cancel</Text></Pressable>
              <Pressable style={[s.btn, { flex: 1 }, (sending || !editText.trim()) && { opacity: 0.5 }]} disabled={sending || !editText.trim()} onPress={() => void saveEdit()}>
                {sending ? <ActivityIndicator color="#000" /> : <Text style={s.btnT}>Save</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      )}

      {thread && (
        <View style={[s.overlay, { justifyContent: 'flex-end' }]}>
          <Pressable style={{ flex: 1 }} onPress={() => setThread(null)} />
          <View style={[s.thread]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <Text style={[s.name, { flex: 1 }]}>Replies ({replies.length})</Text>
              <Pressable accessibilityLabel="Close replies" onPress={() => setThread(null)} hitSlop={8}><Icon name="x" size={18} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
              {bubble(thread, true)}
              {replies.length === 0 && <Text style={[s.muted, { textAlign: 'center' }]}>No replies yet.</Text>}
              {replies.map((r) => bubble(r, true))}
            </ScrollView>
            {group.comments_enabled === false ? <Text style={[s.hint, { textAlign: 'center' }]}>Messages are turned off for this group</Text>
              : (!group.joined && !isOwnerish) ? <Text style={s.err}>Join the group to reply.</Text> : (
              <View style={{ marginTop: 8 }}>
                {!!err && <Text style={s.err}>{err}</Text>}
                <RichTextInput multiline label="Reply" value={replyDraft} onChange={setReplyDraft} placeholder="Write a reply…" sending={sending} onSend={() => void send('text', replyDraft, undefined, thread.id)} />
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function MenuBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={{ paddingVertical: 12 }}><Text style={{ color: danger ? '#FF3B30' : '#fff', fontWeight: '800', fontSize: 15 }}>{label}</Text></Pressable>;
}

/** Settings: owners edit the group; only the main owner can pin, replace/add owner or delete. Each action shows progress + result. */
function OwnerSettings({ group, me, owner, err, setErr, onChanged, onClose, onDeleted }: {
  group: Group; me: string; owner: boolean; err: string; setErr: (e: string) => void; onChanged: () => void; onClose: () => void; onDeleted: () => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; username: string | null; display_name: string | null; public_id: string | null }[]>([]);
  const [pin, setPin] = useState('100');
  const [busy, setBusy] = useState('');
  const [info, setInfo] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key); setErr(''); setInfo('');
    try { await fn(); setInfo(`✓ ${ok}`); onChanged(); } catch (e) { setErr(`✕ ${friendlyError(e)}`); }
    setBusy('');
  };
  const search = () => run('find', async () => { const r = await findGroupUser(q); setFound(r); if (!r.length) throw new Error('No user found with this ID'); }, 'User found');
  const Btn2 = ({ k, label, onPress, danger }: { k: string; label: string; onPress: () => void; danger?: boolean }) => (
    <Pressable accessibilityLabel={label} disabled={!!busy} onPress={onPress} style={[danger ? s.dangerBtn : s.btn, { marginTop: 8 }, !!busy && { opacity: 0.5 }]}>
      {busy === k ? <ActivityIndicator color={danger ? '#fff' : '#000'} /> : <Text style={danger ? s.dangerT : s.btnT}>{label}</Text>}
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: group.comments_enabled !== false }} testID="group-comments-toggle"
        onPress={() => void run('comments', () => setGroupComments(group.id, group.comments_enabled === false), 'Updated')}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
        <View style={{ flex: 1 }}><Text style={s.name}>Allow messages</Text><Text style={s.muted}>When off, members can read old messages but can't send new ones.</Text></View>
        <View style={{ width: 46, height: 26, borderRadius: 13, padding: 3, backgroundColor: group.comments_enabled !== false ? A : '#444', alignItems: group.comments_enabled !== false ? 'flex-end' : 'flex-start' }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} />
        </View>
      </Pressable>
      {!!err && <Text style={s.err}>{err}</Text>}
      {!!info && <Text style={{ color: '#34C759', fontWeight: '800' }}>{info}</Text>}
      <GroupForm color={group.avatar_color} cta="Save changes" initial={{ title: group.name, description: group.description, photo: group.photo, fees: feesOf(group) }}
        onSubmit={async (v) => { await updateGroup(group.id, { ...v, photo: v.photo === group.photo ? '' : v.photo }); onChanged(); onClose(); }} />
      {owner && (
        <>
          <View style={s.feeBox}>
            <Text style={s.label}>Pin group to the top of the list</Text>
            <Text style={s.hint}>Minimum 100 coins. The group with the most pinned coins is listed first.{group.pin_coins ? ` Currently pinned with ${group.pin_coins} coins.` : ''}</Text>
            <TextInput keyboardType="numeric" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} style={[s.input, { marginTop: 8 }]} accessibilityLabel="Pin coins" />
            <Btn2 k="pin" label={group.pin_coins ? 'Add coins to pin' : 'Pin group'} onPress={() => void run('pin', async () => { const n = Number(pin) || 0; if (n < 100) throw new Error('Pinning costs at least 100 coins'); await pinGroup(group.id, n); }, 'Group pinned')} />
            {!!group.pin_coins && <Btn2 k="unpin" label="Remove pin (no refund)" onPress={() => void run('unpin', () => unpinGroup(group.id), 'Pin removed')} />}
          </View>
          <View style={s.feeBox}>
            <Text style={s.label}>Owners</Text>
            <Text style={s.hint}>Find a user by their ID. Replacing makes them the owner and you leave the group immediately; adding gives them owner rights too.</Text>
            {!!group.co_owners?.length && group.co_owners.map((id) => (
              <View key={id} style={s.feeRow}><Text style={s.feeT} numberOfLines={1}>Co-owner · {id.slice(0, 8)}…</Text>
                <Pressable disabled={!!busy} onPress={() => void run(`rm${id}`, () => removeGroupOwner(group.id, id), 'Owner removed')}><Text style={{ color: '#FF3B30', fontWeight: '800' }}>Remove</Text></Pressable></View>
            ))}
            <TextInput value={q} onChangeText={setQ} placeholder="User ID" placeholderTextColor={PH} autoCapitalize="none" style={[s.input, { marginTop: 8 }]} accessibilityLabel="Find user by ID" />
            <Btn2 k="find" label="Find user" onPress={() => void search()} />
            {found.map((u) => (
              <View key={u.id} style={[s.earnRow, { marginTop: 8, flexDirection: 'column', alignItems: 'stretch' }]}>
                <Text style={s.name}>{u.display_name || u.username} · @{u.username}</Text>
                <Text style={s.muted}>ID {u.public_id ?? u.id}</Text>
                <Btn2 k={`add${u.id}`} label="Add as owner" onPress={() => void run(`add${u.id}`, async () => { await addGroupOwner(group.id, u.id); setFound([]); }, 'Owner added')} />
                <Btn2 k={`rep${u.id}`} label="Replace owner (I leave the group)" danger onPress={() => void run(`rep${u.id}`, async () => { await replaceGroupOwner(group.id, u.id); onDeleted(); }, 'Owner replaced')} />
              </View>
            ))}
          </View>
          <View style={s.feeBox}>
            <Text style={s.label}>Danger zone</Text>
            {confirmDel ? (
              <>
                <Text style={s.err}>This permanently deletes the group, all messages and replies.</Text>
                <Btn2 k="del" label="Yes, delete group" danger onPress={() => void run('del', async () => { await deleteGroupOwner(group.id); onDeleted(); }, 'Group deleted')} />
                <Pressable onPress={() => setConfirmDel(false)}><Text style={[s.hint, { textAlign: 'center', marginTop: 10 }]}>Cancel</Text></Pressable>
              </>
            ) : <Btn2 k="ask" label="Delete group" danger onPress={() => setConfirmDel(true)} />}
          </View>
        </>
      )}
    </ScrollView>
  );
}

export function GroupsScreen({ onBack, initialGroupId }: { onBack: () => void; initialGroupId?: string | null }) {
  const [list, setList] = useState<Group[] | null>(null);
  const [me, setMe] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(initialGroupId ?? null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState<Record<string, number>>({});
  const loadUnread = useCallback(() => { void groupUnread().then(setUnread).catch(() => undefined); }, []);
  useEffect(() => { loadUnread(); }, [loadUnread, openId]);
  useEffect(() => subscribeTables('grp-unread', [{ table: T.groupMessages }], () => loadUnread()), [loadUnread]);

  const load = useCallback(async () => {
    try { const [g, id] = await Promise.all([fetchGroups(), myIdOrNull()]); setList(g); setMe(id); setError(''); }
    catch (e) { setError(friendlyError(e)); setList((l) => l ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeTables('groups', [{ table: T.groups }, { table: T.groupMembers }], () => void load()), [load]);

  const toggleJoin = async (g: Group) => {
    if (!requireSignIn()) return;
    setBusy(g.id); setError(''); setInfo('');
    try {
      const paid = await setGroupMembership(g.id, !g.joined);
      setInfo(g.joined ? `Left ${richToPlain(g.name)}` : paid > 0 ? `Joined ${richToPlain(g.name)} 🐝 · ${paid} coins paid` : `Joined ${richToPlain(g.name)} 🐝 · free`);
      await load();
    } catch (e) {
      const m = (e as Error).message;
      setError(/insufficient/i.test(m) ? `Not enough coins — joining ${richToPlain(g.name)} costs ${g.fee_join} coins` : friendlyError(e));
    } finally { setBusy(null); }
  };

  // "All groups" lists every group; "Your groups" lists the ones the user created or joined.
  // Search matches the group name and description inside the active tab.
  const qt = q.trim().toLowerCase();
  const visible = useMemo(() => (list ?? []).filter((g) => (tab !== 'mine' || g.owner_id === me || g.joined)
    && (!qt || richToPlain(g.name).toLowerCase().includes(qt) || richToPlain(g.description ?? '').toLowerCase().includes(qt))), [list, tab, me, qt]);
  const open = list?.find((g) => g.id === openId);
  if (open) return <GroupDetail group={open} me={me} onBack={() => setOpenId(null)} onChanged={() => void load()} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <View style={s.seg}>
        {([['all', 'All groups'], ['mine', 'Your groups'], ['create', 'Create group']] as [Tab, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => { if (k !== 'all' && !requireSignIn()) return; setTab(k); }} style={[s.segI, tab === k && { backgroundColor: A }]}><Text style={[s.segT, tab === k && { color: '#000' }]}>{l}</Text></Pressable>
        ))}
      </View>
      {tab !== 'create' && (
        <View style={s.searchRow}>
          <Icon name="search" size={16} color="rgba(255,255,255,0.4)" />
          <TextInput value={q} onChangeText={setQ} placeholder="Search groups" placeholderTextColor="rgba(255,255,255,0.4)" style={s.searchIn} accessibilityLabel="Search groups" />
          {!!q && <Pressable accessibilityLabel="Clear group search" onPress={() => setQ('')}><Icon name="x" size={16} color="rgba(255,255,255,0.5)" /></Pressable>}
        </View>
      )}
      {!!error && <Text style={s.err}>{error}</Text>}
      {!!info && <Text style={{ color: A, fontWeight: '700' }}>{info}</Text>}
      {tab === 'create' ? (
        <GroupForm key={formKey} color={A} cta="Create group" initial={{ title: '', description: '', photo: '', fees: DEFAULT_FEES }}
          onSubmit={async (v) => { await createGroup(v); setFormKey((k) => k + 1); setTab('mine'); await load(); }} />
      ) : (
        <>
          {list === null && <ActivityIndicator color={colors.primary} />}
          {list !== null && visible.length === 0 && <Text style={[s.muted, { textAlign: 'center', paddingVertical: 40, fontSize: 14 }]}>{qt ? 'No groups match your search.' : tab === 'mine' ? 'Groups you create or join will appear here.' : 'No groups yet.'}</Text>}
          {visible.map((g) => (
            <View key={g.id} style={s.row}>
              <Pressable accessibilityLabel={`Open ${richToPlain(g.name)}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }} onPress={() => { if (requireSignIn()) setOpenId(g.id); }}>
                <GroupAvatar photo={g.photo} title={richToPlain(g.name)} color={g.avatar_color} size={48} />
                <View style={{ flex: 1 }}>
                  <RichTextView html={g.name} style={s.name} numberOfLines={1} />
                  <RichTextView html={g.description} style={s.muted} numberOfLines={1} />
                  <Text style={[s.muted, { fontSize: 11 }]}>{g.pin_coins ? '📌 ' : ''}{g.member_count.toLocaleString('en-US')} members · {g.fee_join > 0 ? `${g.fee_join} coins to join` : 'free to join'}</Text>
                </View>
                {!!unread[g.id] && (g.joined || g.owner_id === me) && <View style={s.badge}><Text style={s.badgeT}>{unread[g.id] > 99 ? '99+' : unread[g.id]}</Text></View>}
              </Pressable>
              {g.owner_id === me ? <Text style={s.ownerTag}>Owner</Text> : (
                <Pressable disabled={busy === g.id} onPress={() => void toggleJoin(g)} style={[g.joined ? s.outline : s.btn, busy === g.id && { opacity: 0.5 }]}>
                  <Text style={g.joined ? s.outlineT : s.btnT}>{g.joined ? 'Joined' : 'Join'}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

export const s = StyleSheet.create({
  pad: { padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h: { color: '#fff', fontWeight: '900', fontSize: 18 },
  seg: { flexDirection: 'row', gap: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)', padding: 4 },
  segI: { flex: 1, borderRadius: 99, paddingVertical: 8, alignItems: 'center' },
  segT: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800' },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 4 },
  chip: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: A, borderWidth: 2, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  avFallback: { alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#000', fontWeight: '900' },
  feeBox: { gap: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', padding: 12 },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeT: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  feeIn: { width: 72, height: 36, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff', textAlign: 'right', paddingHorizontal: 8 },
  cta: { flexDirection: 'row', gap: 8, backgroundColor: A, borderRadius: 99, height: 46, alignItems: 'center', justifyContent: 'center' },
  ctaT: { color: '#000', fontWeight: '900' },
  btn: { backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  btnT: { color: '#000', fontWeight: '900', fontSize: 12 },
  outline: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  outlineT: { color: '#fff', fontWeight: '800', fontSize: 12 },
  ownerTag: { color: A, backgroundColor: 'rgba(255,165,0,0.2)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: '800', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, backgroundColor: '#161616' },
  name: { color: '#fff', fontWeight: '800', fontSize: 14 },
  muted: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  err: { color: '#FF6B6B', fontWeight: '700' },
  detail: { flex: 1, backgroundColor: '#000' },
  dHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  mAv: { width: 28, height: 28, borderRadius: 14, alignSelf: 'flex-end' },
  bMine: { maxWidth: '75%', borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: A, paddingHorizontal: 12, paddingVertical: 8 },
  bOther: { maxWidth: '75%', borderRadius: 16, borderBottomLeftRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 8 },
  author: { color: A, fontSize: 11, fontWeight: '800', marginBottom: 2 },
  mImg: { width: 220, height: 220, borderRadius: 12, marginBottom: 4 },
  time: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 180, paddingVertical: 4 },
  wave: { flex: 1, height: 4, borderRadius: 2 },
  composer: { borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  recOn: { height: 40, borderRadius: 20, backgroundColor: '#FF3B30', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopSq: { width: 10, height: 10, backgroundColor: '#fff', borderRadius: 2 },
  recT: { color: '#fff', fontWeight: '900', fontSize: 12 },
  msgIn: { flex: 1, minHeight: 42, maxHeight: 110, backgroundColor: '#1c1c1c', color: '#fff', borderRadius: 21, paddingHorizontal: 14, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: A, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderRadius: 99, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  searchIn: { flex: 1, color: '#fff', fontSize: 14 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24, zIndex: 50 },
  menu: { backgroundColor: '#161616', borderRadius: 16, padding: 18 },
  thread: { backgroundColor: '#0A0A0B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '85%' },
  dangerBtn: { backgroundColor: '#FF3B30', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  dangerT: { color: '#fff', fontWeight: '900', fontSize: 13 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeT: { color: '#fff', fontSize: 11, fontWeight: '900' },
  earnCard: { borderRadius: 16, backgroundColor: A, padding: 16 },
  earnL: { color: 'rgba(0,0,0,0.7)', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  earnV: { color: '#000', fontSize: 30, fontWeight: '900', marginTop: 4 },
  kindBox: { flex: 1, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, alignItems: 'center' },
  earnRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 10 },
});
