import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export interface Note {
  id: number;
  text: string;
  /** Rich HTML (per-word colors). Older notes only have text + one color. */
  html?: string;
  color: string;
  bold: boolean;
  underline: boolean;
  at: number;
}

export const NOTES_KEY = 'beetook_notes_v1';
export const NOTE_COLORS = ['#FFFFFF', '#FF2D55', '#FFA500', '#FFD700', '#34C759', '#0A84FF', '#AF52DE'] as const;

/** Device-local notes store (same key as the web app's localStorage). */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(NOTES_KEY)
      .then((raw) => {
        const parsed = JSON.parse(raw ?? '[]') as Partial<Note>[];
        setNotes(Array.isArray(parsed) ? parsed.filter((n) => typeof n.text === 'string') as Note[] : []);
      })
      .catch(() => setNotes([]));
  }, []);

  const persist = useCallback((updater: (prev: Note[]) => Note[]) => {
    setNotes((prev) => {
      const next = updater(prev);
      void AsyncStorage.setItem(NOTES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const upsert = useCallback(
    (note: Omit<Note, 'id' | 'at'>, id: number | null) =>
      persist((prev) =>
        id === null ? [{ ...note, id: Date.now(), at: Date.now() }, ...prev] : prev.map((n) => (n.id === id ? { ...n, ...note } : n)),
      ),
    [persist],
  );

  const remove = useCallback((id: number) => persist((prev) => prev.filter((n) => n.id !== id)), [persist]);

  return { notes, upsert, remove };
}
