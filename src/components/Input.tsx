// One input look for the whole app: no outline/border anywhere (including the browser focus ring on web).
// Focus and error are shown with the fill colour instead.
import { useState } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps } from 'react-native';

// Web: browsers draw a white/blue focus ring around focused fields. Remove it once, for every input in the app.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('bt-no-input-outline')) {
  const st = document.createElement('style');
  st.id = 'bt-no-input-outline';
  st.textContent = 'input,textarea,select,input:focus,textarea:focus,select:focus,input:focus-visible,textarea:focus-visible{outline:none!important;box-shadow:none!important;}';
  document.head.appendChild(st);
}

const noOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0, borderWidth: 0 } as object) : { borderWidth: 0 };

export const inputStyles = StyleSheet.create({
  base: {
    minHeight: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)',
    color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, ...noOutline,
  },
  focus: { backgroundColor: 'rgba(255,165,0,0.12)' },
  error: { backgroundColor: 'rgba(255,59,48,0.14)' },
});

/** Text input used by every form in the app. `error` turns the fill red; focus turns it amber. */
export function AppInput({ error, style, onFocus, onBlur, placeholderTextColor, ...rest }: TextInputProps & { error?: boolean }) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      underlineColorAndroid="transparent"
      {...rest}
      placeholderTextColor={placeholderTextColor ?? 'rgba(255,255,255,0.35)'}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={[inputStyles.base, focus && !error && inputStyles.focus, error && inputStyles.error, style, noOutline]}
    />
  );
}
