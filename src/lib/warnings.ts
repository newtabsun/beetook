// Admin warning text per user: cached, fetched once, then kept fresh by one shared Realtime channel.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const TABLE = 'app_9e1318caf6_warnings';
const cache = new Map<string, string | null>();
const subs = new Set<() => void>();
let channel: unknown = null;
const emit = () => subs.forEach((f) => f());

function ensureChannel() {
  if (channel) return;
  channel = supabase.channel('warnings-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, (p: any) => {
      const row = p.new?.user_id ? p.new : p.old;
      if (!row?.user_id) return;
      cache.set(row.user_id, p.eventType === 'DELETE' ? null : (p.new?.text ?? ''));
      emit();
    })
    .subscribe();
}

/** The admin's warning text for a user, or null when there is none. */
export function useWarningText(id?: string | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    ensureChannel();
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (!cache.has(id)) {
      void supabase.from(TABLE).select('text').eq('user_id', id).maybeSingle().then(({ data }) => {
        cache.set(id, (data as { text: string } | null)?.text ?? null);
        emit();
      });
    }
    return () => { subs.delete(f); };
  }, [id]);
  return id ? cache.get(id) ?? null : null;
}
