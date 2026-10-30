// App-wide keyboard handling. Android edge-to-edge ignores adjustResize, so we pad the
// container by the measured keyboard height (native: Keyboard events, web: visualViewport).
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

export function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv) return;
      let raf = 0;
      const update = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const gap = Math.round(window.innerHeight - vv.height - vv.offsetTop);
          setH((p) => { const n = gap > 80 ? gap : 0; return p === n ? p : n; });
        });
      };
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => { cancelAnimationFrame(raf); vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, (e) => setH(Math.round(e.endCoordinates.height)));
    const b = Keyboard.addListener(hideEvt, () => setH(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return h;
}

/** Pads its bottom by the keyboard height so focused inputs and chat composers stay visible. */
export function KeyboardInset({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const h = useKeyboardHeight();
  return <View style={[{ flex: 1 }, style, h ? { paddingBottom: h } : null]}>{children}</View>;
}
