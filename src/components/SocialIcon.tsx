import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Official-style glyphs, identical paths to the web SocialIcon. */
const PATHS: Record<string, string> = {
  telegram:
    'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  tiktok:
    'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.080-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.070-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  facebook:
    'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z',
  youtube:
    'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
};

const BG: Record<string, string> = {
  telegram: '#26A5E4',
  tiktok: '#000',
  facebook: '#0866FF',
  youtube: '#fff',
  x: '#000',
};

export const SocialIcon = memo(function SocialIcon({ id, label }: { id: string; label: string }) {
  if (id === 'instagram') {
    return (
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <Defs>
          <RadialGradient id="ig" cx="30%" cy="107%" r="130%">
            <Stop offset="0" stopColor="#FDF497" />
            <Stop offset="0.45" stopColor="#FD5949" />
            <Stop offset="0.6" stopColor="#D6249F" />
            <Stop offset="0.9" stopColor="#285AEB" />
          </RadialGradient>
        </Defs>
        <Rect width={36} height={36} rx={12} fill="url(#ig)" />
        <Rect x={10.5} y={10.5} width={15} height={15} rx={4.2} fill="none" stroke="#fff" strokeWidth={1.7} />
        <Circle cx={18} cy={18} r={3.5} fill="none" stroke="#fff" strokeWidth={1.7} />
        <Circle cx={22.5} cy={13.5} r={0.9} fill="#fff" />
      </Svg>
    );
  }
  const path = PATHS[id];
  const outlined = id === 'tiktok' || id === 'x';
  return (
    <View style={[s.box, { backgroundColor: BG[id] ?? '#FFA500' }, outlined && s.outline]}>
      {path ? (
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path d={path} fill={id === 'youtube' ? '#FF0000' : '#fff'} />
        </Svg>
      ) : (
        <Text style={s.letter}>{label[0]}</Text>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  box: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  letter: { fontSize: 12, fontWeight: '800', color: '#000' },
});
