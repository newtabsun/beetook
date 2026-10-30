// Client for the `auth-email` edge function (Resend codes): forgot password, change email, password-confirmed
// redeem, and two-step login. Passwords are always the normal LOGIN password — there is no separate one.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { friendlyError } from './errors';
import { supabase } from './supabase';

const P = 'app_9e1318caf6_';
const DEVICE_KEY = 'beetook:device-id';

export class AuthEmailError extends Error {
  constructor(public code: string, public extra: Record<string, unknown> = {}) {
    super(describe(code, extra));
  }
}

function describe(code: string, x: Record<string, unknown>): string {
  const left = typeof x.left === 'number' ? x.left : null;
  switch (code) {
    case 'EMAIL_INVALID': return 'Enter a valid email address';
    case 'EMAIL_TAKEN': return 'This email is already used by another account';
    case 'SAME_EMAIL': return 'This is already your email address';
    case 'WAIT': return `Please wait ${Number(x.seconds) || 30} seconds before asking for a new one`;
    case 'TOO_MANY': return 'Too many requests. Please try again in an hour';
    case 'TOO_MANY_ATTEMPTS': return 'Too many wrong attempts. Please try again later';
    case 'CODE_INVALID': return left !== null ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong code';
    case 'CODE_EXPIRED': return 'This code expired. Ask for a new one';
    case 'WRONG_PASSWORD': return left !== null ? `Wrong password. ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong password';
    case 'PASSWORD_SHORT': return 'Password must be 6+ characters';
    case 'PASSWORD_REJECTED': return 'This password is not accepted. Try a stronger one';
    case 'INVALID_CREDENTIALS': return 'Wrong email or password';
    case 'EMAIL_NOT_CONFIRMED': return 'Confirm your email first, then log in';
    case 'EMAIL_NOT_CONFIGURED': return 'Email sending is not set up yet';
    case 'EMAIL_SEND_FAILED': return 'We could not send the email. Please try again';
    case 'AUTH_REQUIRED': return 'Please log in again';
    default: return 'Something went wrong. Please try again';
  }
}

/** Message for the user: our own text for server answers, the shared friendly text for network failures. */
export const authMessage = (e: unknown) => (e instanceof AuthEmailError ? e.message : friendlyError(e));

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('auth-email', { body: { action, ...body } });
  if (error) {
    let payload: { error?: string } | null = null;
    try { payload = await (error as unknown as { context?: Response }).context?.json(); } catch { payload = null; }
    if (payload?.error) throw new AuthEmailError(payload.error, payload as Record<string, unknown>);
    throw new Error(error.message);
  }
  const d = data as { error?: string } | null;
  if (d?.error) throw new AuthEmailError(d.error, d as Record<string, unknown>);
  return data as T;
}

/** Random id kept on this install; the server remembers it as a trusted device after a verified login. */
export async function deviceId(): Promise<string> {
  const saved = await AsyncStorage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const id = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')).join('');
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

export const forgotSend = (email: string) => call<{ ok: true }>('forgot_send', { email });
export const forgotReset = (email: string, code: string, password: string) => call<{ ok: true }>('forgot_reset', { email, code, password });
export const emailChangeSend = (newEmail: string) => call<{ ok: true }>('email_change_send', { new_email: newEmail });
export const emailChangeConfirm = (code: string) => call<{ ok: true; email: string }>('email_change_confirm', { code });
/** Checks the login password; returns a single-use token valid for 10 minutes that the redeem RPC requires. */
export const redeemVerify = async (password: string) => (await call<{ token: string }>('redeem_verify', { password })).token;

export async function loadTwoStep(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const { data } = await supabase.from(`${P}security`).select('two_step').eq('user_id', u.user.id).maybeSingle();
  return !!(data as { two_step?: boolean } | null)?.two_step;
}
export async function setTwoStep(enabled: boolean, password?: string) {
  await call<{ ok: true }>('two_step_set', { enabled, password: password ?? '', device_id: await deviceId() });
}

export type LoginResult = { status: 'ok' } | { status: 'code_required'; challengeId: string; email: string };
type LoginReply = { status: 'ok'; session: { access_token: string; refresh_token: string } } | { status: 'code_required'; challenge_id: string; email: string };

async function finish(r: LoginReply): Promise<LoginResult> {
  if (r.status === 'ok') {
    const { error } = await supabase.auth.setSession(r.session);
    if (error) throw new Error(error.message);
    return { status: 'ok' };
  }
  return { status: 'code_required', challengeId: r.challenge_id, email: r.email };
}
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  return finish(await call<LoginReply>('login', { email, password, device_id: await deviceId() }));
}
export async function loginVerify(challengeId: string, code: string): Promise<LoginResult> {
  return finish(await call<LoginReply>('login_verify', { challenge_id: challengeId, code, device_id: await deviceId() }));
}
export async function loginResend(challengeId: string): Promise<LoginResult> {
  return finish(await call<LoginReply>('login_resend', { challenge_id: challengeId }));
}

/** Redeem is only accepted together with the token from `redeemVerify`. */
export async function createRedeemSecure(method: string, coins: number, fields: Record<string, string>, key: string, token: string) {
  const { data, error } = await supabase.rpc(`${P}redeem_create_secure`, { p_method: method, p_coins: coins, p_fields: fields, p_idempotency: key, p_token: token });
  if (error) throw new Error(/PASSWORD_REQUIRED/.test(error.message) ? 'Please confirm your password again' : error.message);
  return data as { id: string; status: string; duplicate?: boolean };
}
