// Drafts are stored in Supabase; failed uploads are also kept on the device (pendingPosts) until they succeed.
import { useCallback, useEffect, useState } from 'react';
import { deletePost, fetchMyPosts, savePost, type PostInput } from '../../lib/api';
import { loadPending, removePending, savePending } from '../../lib/pendingPosts';
import { invalidate } from '../../lib/swr';
import { DEFAULT_PUBLISH_OPTIONS, type PublishOptions } from './PostOptions';
import type { MediaEdit } from '../editor/edit';

export interface PostDraft { id: string; kind: 'photos' | 'video'; sources: string[]; caption: string; captionHtml?: string; options?: PublishOptions; scheduleAt?: number; edit?: MediaEdit; remote?: boolean; pending?: boolean }

export function usePosts() {
  const [drafts, setDrafts] = useState<PostDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const pending = await loadPending().catch(() => [] as PostDraft[]);
    let remote: PostDraft[] | null = null;
    try {
      const rows = await fetchMyPosts('draft');
      remote = rows.map((r) => ({ id: r.id, kind: r.kind, sources: r.media_urls, caption: r.caption, captionHtml: r.caption_html || r.caption, edit: r.edit ?? undefined, remote: true,
        options: { ...DEFAULT_PUBLISH_OPTIONS, thumbnail: r.thumbnail_url ?? null, privacy: r.privacy ?? 'everyone', download: r.allow_download ?? true,
          comments: r.allow_comments ?? true, duet: r.allow_duet ?? true, ageRestricted: r.age_restricted ?? false, partner: r.partner_enabled ?? true} }));
    } catch { /* not signed in / offline: keep list */ }
    const ids = new Set(pending.map((x) => x.id));
    setDrafts((prev) => [...pending, ...(remote ?? prev.filter((d) => !d.pending)).filter((d) => !ids.has(d.id))]);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const toInput = (p: PostDraft): PostInput => ({ id: p.remote ? p.id : undefined, kind: p.kind, sources: p.sources, caption: p.caption, captionHtml: p.captionHtml ?? p.caption, edit: p.edit, scheduleAt: p.scheduleAt,
    settings: (({ scheduleAt: _s, ...rest }) => rest)(p.options ?? DEFAULT_PUBLISH_OPTIONS) });
  return {
    drafts, loading, refresh,
    /** Offline: the draft is kept on the device instead of failing. */
    saveDraft: async (p: PostDraft) => {
      try { await savePost(toInput(p), 'draft'); invalidate('me:tab:'); await removePending(p.id); } catch { await savePending(p); }
      await refresh();
    },
    deleteDraft: async (id: string) => {
      if (drafts.find((x) => x.id === id)?.pending) await removePending(id); else await deletePost(id);
      setDrafts((d) => d.filter((x) => x.id !== id));
    },
    publish: async (p: PostDraft, onProgress?: (done: number, total: number) => void) => {
      try {
        const r = await savePost(toInput(p), 'publish', onProgress);
        invalidate('me:');
        await removePending(p.id).catch(() => undefined);
        await refresh();
        return r as 'scheduled' | 'posted';
      } catch (e) {
        await savePending({ ...p, scheduleAt: p.scheduleAt }).catch(() => undefined);
        await refresh();
        throw e;
      }
    },
  };
}
