// Rich text (color / bold / underline) compatible with the web prototype's HTML format.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useMyVip } from './Vip';
import { Icon } from './Icons';
import { notify } from '../lib/notify';

export const TEXT_COLORS = ['#FFFFFF', '#22FF88', '#FFD400', '#FF4D5E', '#3FA9FF', '#00F0FF', '#B6FF3B', '#FF4FD8', '#FFB020', '#B388FF'];

export interface Seg { t: string; c?: string; b?: boolean; u?: boolean }
type Fmt = Omit<Seg, 't'>;

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** Parse the limited HTML produced by the web editor (b/strong/u/span/font/br/div). */
export function parseRich(html: string): Seg[] {
  const out: Seg[] = [];
  const stack: Fmt[] = [{}];
  const re = /<\/?([a-zA-Z]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const push = (t: string) => { if (t) out.push({ t, ...stack[stack.length - 1] }); };
  while ((m = re.exec(html ?? ''))) {
    if (m[3] !== undefined) { push(decode(m[3])); continue; }
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (tag === 'br') { push('\n'); continue; }
    if (closing) { if (stack.length > 1) stack.pop(); if (tag === 'div' || tag === 'p') push('\n'); continue; }
    const cur: Fmt = { ...stack[stack.length - 1] };
    const attrs = m[2];
    if (tag === 'b' || tag === 'strong') cur.b = true;
    if (tag === 'u') cur.u = true;
    const color = /color\s*[:=]\s*["']?\s*([#\w(),.\s]+?)["';]/i.exec(attrs + ';');
    if (color) cur.c = color[1].trim();
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs)) cur.b = true;
    if (/text-decoration[^;"]*underline/i.test(attrs)) cur.u = true;
    if (tag === 'div' || tag === 'p') { if (out.length && !out[out.length - 1].t.endsWith('\n')) push('\n'); }
    stack.push(cur);
  }
  return merge(out.length && out[out.length - 1].t === '\n' ? out.slice(0, -1) : out);
}

const same = (a: Fmt, b: Fmt) => (a.c ?? '') === (b.c ?? '') && !!a.b === !!b.b && !!a.u === !!b.u;
function merge(segs: Seg[]): Seg[] {
  const r: Seg[] = [];
  for (const s of segs) {
    if (!s.t) continue;
    const l = r[r.length - 1];
    if (l && same(l, s)) l.t += s.t; else r.push({ ...s });
  }
  return r;
}

export function toHtml(segs: Seg[]): string {
  return segs.map((s) => {
    const st = [s.c && `color: ${s.c}`, s.b && 'font-weight: bold', s.u && 'text-decoration: underline'].filter(Boolean).join('; ');
    return st ? `<span style="${st};">${encode(s.t)}</span>` : encode(s.t);
  }).join('');
}

export const plain = (segs: Seg[]) => segs.map((s) => s.t).join('');
export const richToPlain = (html: string | null | undefined) => plain(parseRich(html ?? '')).trim();

/** Split into single-char formats for easy range edits. */
const explode = (segs: Seg[]) => segs.flatMap((s) => Array.from(s.t).map((ch) => ({ ...s, t: ch })));

function applyFmt(segs: Seg[], start: number, end: number, patch: (f: Fmt) => Fmt): Seg[] {
  return merge(explode(segs).map((s, i) => (i >= start && i < end ? { ...s, ...patch(s), t: s.t } : s)));
}

/** Reconcile a plain-text edit into the segment list, new chars inherit neighbouring style. */
function editText(segs: Seg[], next: string, typing: Fmt): Seg[] {
  const chars = explode(segs);
  const prev = chars.map((c) => c.t);
  const nx = Array.from(next);
  let a = 0;
  while (a < prev.length && a < nx.length && prev[a] === nx[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < nx.length - a && prev[prev.length - 1 - b] === nx[nx.length - 1 - b]) b++;
  const inserted = nx.slice(a, nx.length - b).map((t) => ({ ...typing, t }));
  return merge([...chars.slice(0, a), ...inserted, ...chars.slice(prev.length - b)]);
}

export function RichTextView({ html, style, numberOfLines, onMention }: { html: string | null | undefined; style?: TextStyle | TextStyle[]; numberOfLines?: number; onMention?: (name: string) => void }) {
  const segs = parseRich(html ?? '');
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segs.map((s, i) => (
        <Text key={i} style={[s.c ? { color: s.c } : null, s.b ? { fontWeight: '900' } : null, s.u ? { textDecorationLine: 'underline' } : null]}>
          {onMention ? s.t.split(/(@[^\s@#,;:!?()]+)/).map((part, j) => (part.startsWith('@') && part.length > 1
            ? <Text key={j} onPress={() => onMention(part.slice(1).replace(/[.]+$/, ''))} style={{ color: s.c ?? '#3B82F6', fontWeight: '800' }}>{part}</Text>
            : part)) : s.t}
        </Text>
      ))}
    </Text>
  );
}

const MARQUEE_SPEED = 50; // px per second, independent of text length
const NATIVE = Platform.OS !== 'web';

/** Bio that scrolls right → left continuously (web `.bio-marquee`). */
export function MarqueeRich({ html, style }: { html: string; style?: TextStyle }) {
  const x = useRef(new Animated.Value(0)).current;
  const [box, setBox] = useState(0);
  const [w, setW] = useState(0);
  const oneLine = html.replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, ' \u00a0•\u00a0 ').replace(/<br\s*\/?>|\n/gi, ' \u00a0•\u00a0 ');
  useEffect(() => {
    if (!box || !w) return;
    // Shop LED display: enter from the right edge, cross fully off the left edge, restart. Constant px/s.
    const a = Animated.loop(Animated.sequence([
      Animated.timing(x, { toValue: box, duration: 0, useNativeDriver: NATIVE }),
      Animated.timing(x, { toValue: -w, duration: ((box + w) / MARQUEE_SPEED) * 1000, easing: Easing.linear, useNativeDriver: NATIVE }),
    ]));
    a.start();
    return () => a.stop();
  }, [box, w, x]);
  const lineH = (style?.lineHeight ?? (style?.fontSize ?? 14) * 1.4) + 2;
  return (
    <View style={{ overflow: 'hidden', width: '100%', height: lineH }} onLayout={(e) => setBox(e.nativeEvent.layout.width)} accessibilityLabel="Bio">
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 20000, flexDirection: 'row', opacity: box && w ? 1 : 0, transform: [{ translateX: x }] }}>
        <View style={{ alignSelf: 'flex-start', flexShrink: 0 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <Text style={[style ?? {}, { flexShrink: 0 }] as TextStyle[]} numberOfLines={1}>
            {parseRich(oneLine).map((s, i) => (
              <Text key={i} style={[s.c ? { color: s.c } : null, s.b ? { fontWeight: '900' } : null, s.u ? { textDecorationLine: 'underline' } : null]}>{s.t}</Text>
            ))}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

/** Toolbar (bold, underline, 10 colors) + input. Formatting applies to the selection, or to what you type next. */
export function RichTextInput({ value, onChange, placeholder, multiline, label, onSend, sending, freeColors }: { value: string; onChange: (html: string) => void; placeholder?: string; multiline?: boolean; label?: string; onSend?: () => void; sending?: boolean; freeColors?: boolean }) {
  const [segs, setSegs] = useState<Seg[]>(() => parseRich(value));
  useEffect(() => { if (!value) setSegs((p) => (p.length ? [] : p)); }, [value]);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [typing, setTyping] = useState<Fmt>({});
  const myVip = useMyVip();
  const vip = freeColors || myVip; // only VIP can write in color; everyone can read colored text (RichTextView)
  const emit = (n: Seg[]) => { setSegs(n); onChange(plain(n).trim() ? toHtml(n) : ''); };
  const text = plain(segs);
  const toggle = (patch: (f: Fmt) => Fmt) => {
    if (sel.end > sel.start) emit(applyFmt(segs, sel.start, sel.end, patch));
    setTyping((t) => ({ ...t, ...patch(t) }));
  };
  return (
    <View style={{ gap: 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
        <Pressable accessibilityLabel="Bold" style={[r.tb, typing.b && r.tbOn]} onPress={() => toggle((f) => ({ b: !f.b }))}><Text style={[r.tbT, { fontWeight: '900' }]}>B</Text></Pressable>
        <Pressable accessibilityLabel="Underline" style={[r.tb, typing.u && r.tbOn]} onPress={() => toggle((f) => ({ u: !f.u }))}><Text style={[r.tbT, { textDecorationLine: 'underline' }]}>U</Text></Pressable>
        <View style={r.div} />
        {vip ? TEXT_COLORS.map((c) => (
          <Pressable key={c} accessibilityLabel={`Color ${c}`} onPress={() => toggle(() => ({ c }))} style={[r.sw, (typing.c ?? '#FFFFFF') === c && r.swOn]}>
            <View style={{ flex: 1, borderRadius: 99, backgroundColor: c }} />
          </Pressable>
        )) : (
          <Pressable accessibilityLabel="Colored text is a VIP feature" style={r.tb}
            onPress={() => notify('Colored text is for VIP', 'Everyone can read colored text, but writing in color needs VIP. Profile → Menu → VIP.')}>
            <Icon name="palette" size={14} color="rgba(255,255,255,0.5)" />
          </Pressable>
        )}
      </ScrollView>
      <View style={r.field}>
       <View style={{ flex: 1 }}>
        {/* Native: styled spans live inside the TextInput itself, so the cursor always matches the rendered text.
            Web (no rich children support): a styled overlay with identical metrics sits behind a transparent input. */}
        {isWeb ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, r.pad]}>
            <Text style={[r.txt, r.pre]}>
              {segs.map((s, i) => (
                <Text key={i} style={[{ color: s.c ?? '#FFFFFF' }, s.u ? { textDecorationLine: 'underline' } : null]}>{s.t}</Text>
              ))}
            </Text>
          </View>
        ) : null}
        <TextInput
          accessibilityLabel={label ?? placeholder}
          style={[r.pad, r.txt, isWeb ? r.inputWeb : r.input, multiline && { minHeight: 44, maxHeight: 110, textAlignVertical: 'top' }]}
          scrollEnabled={multiline ? true : undefined}
          multiline={multiline}
          {...(isWeb ? { value: text } : {})}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.35)"
          selectionColor={typing.c ?? '#FFA500'}
          cursorColor={typing.c ?? '#FFA500'}
          autoCapitalize="none"
          underlineColorAndroid="transparent"
          onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
          onChangeText={(v) => emit(editText(segs, v, typing))}
        >
          {isWeb ? undefined : segs.map((s, i) => (
            <Text key={i} style={[{ color: s.c ?? '#FFFFFF' }, s.b ? { fontWeight: '900' } : null, s.u ? { textDecorationLine: 'underline' } : null]}>{s.t}</Text>
          ))}
        </TextInput>
       </View>
        {onSend ? (
          <Pressable accessibilityLabel="Send" disabled={sending || !text.trim()} onPress={onSend} hitSlop={8}
            style={[r.sendBtn, (sending || !text.trim()) && { opacity: 0.4 }]}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" stroke="#FFA500" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

const r = StyleSheet.create({
  tb: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  tbOn: { borderColor: '#FFA500' },
  tbT: { color: '#fff', fontSize: 13 },
  div: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 2 },
  sw: { width: 24, height: 24, borderRadius: 12, padding: 3, backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  swOn: { borderWidth: 2, borderColor: '#fff' },
  field: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: 'transparent', borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  sendBtn: { paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingHorizontal: 12, paddingVertical: 10 },
  txt: { fontSize: 14, lineHeight: 20 },
  input: { color: '#FFFFFF', backgroundColor: 'transparent' },
  // Bold is not drawn on web so glyph widths match the transparent input exactly (keeps the caret at the text end).
  inputWeb: { color: 'transparent', backgroundColor: 'transparent', ...({ outlineStyle: 'none', caretColor: '#FFA500' } as object) },
  pre: { ...({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as object) },
  preview: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,165,0,0.25)', backgroundColor: 'rgba(255,255,255,0.02)', padding: 8 },
});
