// Steady progress: counts up one percent at a time at a constant pace (never jumps), waiting only when the real upload is behind.
import { useEffect, useState } from 'react';

export function useSmoothProgress(target: number | null): number | null {
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) { setV(null); return undefined; }
    setV((p) => p ?? 1);
    const t = setInterval(() => setV((p) => { const cur = p ?? 1; return cur < Math.max(target, 1) ? cur + 1 : cur; }), 40);
    return () => clearInterval(t);
  }, [target]);
  return target === null ? null : v;
}
