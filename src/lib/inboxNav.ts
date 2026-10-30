export type InboxPeer = { id: string; username: string | null; display_name: string | null };
type Handler = (peer: InboxPeer, draft?: string) => void;

let handler: Handler | null = null;

/** App registers the navigator; returns an unsubscribe function. */
export function setInboxNavigator(h: Handler): () => void {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

/** Opens the main Inbox chat with `peer`, prefilling an editable (unsent) draft. */
export function openInbox(peer: InboxPeer, draft?: string): void {
  handler?.(peer, draft);
}
