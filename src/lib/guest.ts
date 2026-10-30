// Guest mode: a purely local browsing state. A guest never signs in — no anonymous Supabase user,
// no profile row, no wallet — so nothing is written to the database on their behalf.
// They may watch the feed, browse live covers, the group list and marketplace listings; every other
// tab or action is refused with one shared prompt.
import { useEffect, useState } from 'react';

export type GuestScope = 'tab' | 'action';

let guest = false;
let prompt: ((scope: GuestScope) => void) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const isGuest = () => guest;

/** Set when a guest agrees to sign up, so the auth screen opens on "Sign up". */
let signUpIntent = false;
export const wantSignUp = () => { signUpIntent = true; };
export function consumeSignUpIntent(): boolean { const v = signUpIntent; signUpIntent = false; return v; }

export function setGuest(on: boolean) {
  if (guest === on) return;
  guest = on;
  emit();
}

/** Registered once by the app root; shows the "sign up first?" card. */
export function setSignInPrompt(fn: ((scope: GuestScope) => void) | null) {
  prompt = fn;
}

/** True when the action may proceed. For a guest it shows the prompt and returns false. */
export function requireSignIn(scope: GuestScope = 'action'): boolean {
  if (!guest) return true;
  prompt?.(scope);
  return false;
}

export function useIsGuest(): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return guest;
}

export const GUEST_PROMPT = {
  title: 'Sign up required',
  message: 'You need to sign up first to use this. Would you like to sign up now?',
  confirm: 'Yes, sign up',
  cancel: 'Not now',
} as const;
