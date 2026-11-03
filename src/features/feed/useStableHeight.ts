// Measures the feed viewport but ignores temporary shrinks caused by the soft keyboard,
// so paged video cards keep their size while a comment is being typed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useKeyboardHeight } from '../../components/KeyboardInset';

const SHRINK_SETTLE_MS = 700;

export function useStableHeight() {
  const [h, setH] = useState(0);
  const keyboard = useKeyboardHeight();
  const keyboardRef = useRef(0);
  const heightRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { keyboardRef.current = keyboard; }, [keyboard]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    if (timer.current) clearTimeout(timer.current);
    if (heightRef.current === 0 || next >= heightRef.current) {
      heightRef.current = next;
      setH(next);
      return;
    }
    timer.current = setTimeout(() => {
      if (keyboardRef.current === 0) { heightRef.current = next; setH(next); }
    }, SHRINK_SETTLE_MS);
  }, []);

  return { h, onLayout };
}
