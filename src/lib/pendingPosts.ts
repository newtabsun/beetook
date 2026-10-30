// Posts whose upload failed are kept on the device so nothing is lost; they show up in Drafts with "Retry".
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostDraft } from '../features/post/usePosts';

const KEY = 'beetook_pending_posts_v1';

export async function loadPending(): Promise<PostDraft[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as PostDraft[]) : [];
}

export async function savePending(p: PostDraft) {
  const list = (await loadPending()).filter((x) => x.id !== p.id);
  await AsyncStorage.setItem(KEY, JSON.stringify([{ ...p, pending: true }, ...list]));
}

export async function removePending(id: string) {
  const list = await loadPending();
  await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((x) => x.id !== id)));
}
