// auth-email — Resend-backed account security for Bee Took.
import { createClient } from 'npm:@supabase/supabase-js@2';

const P = 'app_9e1318caf6_';
const env = (k: string) => Deno.env.get(k) ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class HttpError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); }
}

const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const anon = () => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_S = 45;
const HOURLY_LIMIT = 6;
const PW_FAIL_LIMIT = 5;
const PW_FAIL_WINDOW_MIN = 15;

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const mask = (e: string) => { const [a, b] = e.split('@'); return `${a.slice(0, 2)}${'*'.repeat(Math.max(1, a.length - 2))}@${b}`; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

async function sendEmail(to: string, subject: string, heading: string, intro: string, code: string, reqId: string) {
  const key = env('RESEND_API_KEY');
  if (!key) throw new HttpError(500, 'EMAIL_NOT_CONFIGURED');
  const html = `<!doctype html><html><body style="margin:0;background:#000;padding:24px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:440px;margin:0 auto;background:#0D0D0F;border:1px solid #2a2a2a;border-radius:16px;padding:28px;color:#fff">
<div style="font-size:22px;font-weight:800;margin-bottom:18px">Bee<span style="color:#FFA500">Took</span></div>
<div style="font-size:18px;font-weight:800;margin-bottom:8px">${esc(heading)}</div>
<div style="font-size:14px;line-height:21px;color:rgba(255,255,255,.7)">${esc(intro)}</div>
<div style="margin:22px 0;padding:16px;text-align:center;background:#1a1405;border:1px solid #FFA500;border-radius:12px;font-size:34px;letter-spacing:10px;font-weight:800;color:#FFA500">${esc(code)}</div>
<div style="font-size:12px;line-height:18px;color:rgba(255,255,255,.5)">This code expires in ${CODE_TTL_MIN} minutes and works once. If you did not request it, ignore this email — your account stays safe. Never share this code with anyone.</div>
</div></body></html>`;
  const text = `${heading}\n\n${intro}\n\nCode: ${code}\n\nThis code expires in ${CODE_TTL_MIN} minutes. If you did not request it, ignore this email.`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('RESEND_FROM_EMAIL') || 'Bee Took <onboarding@resend.dev>', to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(JSON.stringify({ reqId, resend_status: res.status, resend_body: body }));
    throw new HttpError(502, 'EMAIL_SEND_FAILED', { detail: res.status === 403 || res.status === 422 ? body.slice(0, 300) : undefined });
  }
}

type Challenge = { id: string; user_id: string; purpose: string; code_hash: string; new_email: string | null; attempts: number; expires_at: string; consumed_at: string | null; created_at: string };

async function throttle(userId: string, purpose: string) {
  const db = admin();
  const { data } = await db.from(`${P}auth_challenges`).select('created_at').eq('user_id', userId).eq('purpose', purpose)
    .gte('created_at', ago(3_600_000)).order('created_at', { ascending: false });
  const rows = data ?? [];
  if (rows.length >= HOURLY_LIMIT) throw new HttpError(429, 'TOO_MANY');
  if (rows[0]) {
    const wait = RESEND_GAP_S - Math.floor((Date.now() - new Date(rows[0].created_at).getTime()) / 1000);
    if (wait > 0) throw new HttpError(429, 'WAIT', { seconds: wait });
  }
}

async function createChallenge(userId: string, purpose: string, newEmail?: string) {
  const db = admin();
  const code = randomCode();
  await db.from(`${P}auth_challenges`).update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId).eq('purpose', purpose).is('consumed_at', null);
  const { data, error } = await db.from(`${P}auth_challenges`).insert({
    user_id: userId, purpose, code_hash: await sha256(code), new_email: newEmail ?? null, expires_at: minutes(CODE_TTL_MIN),
  }).select('id').single();
  if (error) throw new Error(error.message);
  return { code, id: (data as { id: string }).id };
}

async function checkCode(userId: string, purpose: string, code: string, id?: string): Promise<Challenge> {
  const db = admin();
  let q = db.from(`${P}auth_challenges`).select('*').eq('user_id', userId).eq('purpose', purpose)
    .is('consumed_at', null).gt('expires_at', new Date().toISOString());
  if (id) q = q.eq('id', id);
  const { data } = await q.order('created_at', { ascending: false }).limit(1);
  const row = (data ?? [])[0] as Challenge | undefined;
  if (!row) throw new HttpError(400, 'CODE_EXPIRED');
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
  if (!/^\d{6}$/.test(code) || (await sha256(code)) !== row.code_hash) {
    await db.from(`${P}auth_challenges`).update({ attempts: row.attempts + 1 }).eq('id', row.id);
    throw new HttpError(400, 'CODE_INVALID', { left: Math.max(0, MAX_ATTEMPTS - row.attempts - 1) });
  }
  return row;
}
const consume = (id: string) => admin().from(`${P}auth_challenges`).update({ consumed_at: new Date().toISOString() }).eq('id', id);

async function authUser(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'AUTH_REQUIRED');
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user?.email) throw new HttpError(401, 'AUTH_REQUIRED');
  return data.user as { id: string; email: string };
}
async function userIdByEmail(email: string): Promise<string | null> {
  const { data } = await admin().rpc(`${P}user_id_by_email`, { p_email: email });
  return (data as string | null) ?? null;
}
async function checkPassword(userId: string, email: string, password: string) {
  const db = admin();
  const { count } = await db.from(`${P}auth_challenges`).select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('purpose', 'pw_fail').gte('created_at', ago(PW_FAIL_WINDOW_MIN * 60_000));
  if ((count ?? 0) >= PW_FAIL_LIMIT) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
  const { error } = await anon().auth.signInWithPassword({ email, password: password ?? '' });
  if (error) {
    await db.from(`${P}auth_challenges`).insert({ user_id: userId, purpose: 'pw_fail', expires_at: minutes(PW_FAIL_WINDOW_MIN) });
    throw new HttpError(401, 'WRONG_PASSWORD', { left: Math.max(0, PW_FAIL_LIMIT - (count ?? 0) - 1) });
  }
  await db.from(`${P}auth_challenges`).delete().eq('user_id', userId).eq('purpose', 'pw_fail');
}
const deviceHash = (userId: string, deviceId: string) => sha256(`${userId}:${deviceId}`);
async function isTrusted(userId: string, deviceId: string) {
  if (!deviceId) return false;
  const h = await deviceHash(userId, deviceId);
  const { data } = await admin().from(`${P}trusted_devices`).select('id').eq('token_hash', h).eq('user_id', userId).maybeSingle();
  if (data) await admin().from(`${P}trusted_devices`).update({ last_used_at: new Date().toISOString() }).eq('id', (data as { id: string }).id);
  return !!data;
}
async function trustDevice(userId: string, deviceId: string) {
  if (!deviceId || deviceId.length < 16) return;
  await admin().from(`${P}trusted_devices`).upsert({ user_id: userId, token_hash: await deviceHash(userId, deviceId), last_used_at: new Date().toISOString() }, { onConflict: 'token_hash' });
}
async function twoStepOn(userId: string) {
  const { data } = await admin().from(`${P}security`).select('two_step').eq('user_id', userId).maybeSingle();
  return !!(data as { two_step?: boolean } | null)?.two_step;
}
const session = (s: { access_token: string; refresh_token: string }) => ({ access_token: s.access_token, refresh_token: s.refresh_token });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

type Body = Record<string, unknown>;
async function handle(action: string, b: Body, req: Request, reqId: string) {
  switch (action) {
    case 'forgot_send': {
      const email = str(b.email).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'EMAIL_INVALID');
      const uid = await userIdByEmail(email);
      if (uid) {
        await throttle(uid, 'forgot');
        const c = await createChallenge(uid, 'forgot');
        await sendEmail(email, 'Your Bee Took password reset code', 'Reset your password', 'Use this code to choose a new password for your Bee Took account.', c.code, reqId);
      }
      return { ok: true };
    }
    case 'forgot_reset': {
      const email = str(b.email).toLowerCase();
      const password = String(b.password ?? '');
      if (password.length < 6) throw new HttpError(400, 'PASSWORD_SHORT');
      const uid = await userIdByEmail(email);
      if (!uid) throw new HttpError(400, 'CODE_INVALID');
      const row = await checkCode(uid, 'forgot', str(b.code));
      const { error } = await admin().auth.admin.updateUserById(uid, { password });
      if (error) throw new HttpError(400, 'PASSWORD_REJECTED', { detail: error.message });
      await consume(row.id);
      await admin().from(`${P}auth_challenges`).delete().eq('user_id', uid).eq('purpose', 'pw_fail');
      return { ok: true };
    }
    case 'email_change_send': {
      const user = await authUser(req);
      const next = str(b.new_email).toLowerCase();
      if (!EMAIL_RE.test(next)) throw new HttpError(400, 'EMAIL_INVALID');
      if (next === user.email.toLowerCase()) throw new HttpError(400, 'SAME_EMAIL');
      const { data: taken } = await admin().rpc(`${P}email_taken`, { p_email: next });
      if (taken) throw new HttpError(409, 'EMAIL_TAKEN');
      await throttle(user.id, 'email_change');
      const c = await createChallenge(user.id, 'email_change', next);
      await sendEmail(next, 'Confirm your new Bee Took email', 'Confirm your new email', 'Enter this code in Bee Took to make this address your account email.', c.code, reqId);
      return { ok: true };
    }
    case 'email_change_confirm': {
      const user = await authUser(req);
      const row = await checkCode(user.id, 'email_change', str(b.code));
      const next = (row.new_email ?? '').toLowerCase();
      const { data: taken } = await admin().rpc(`${P}email_taken`, { p_email: next });
      if (taken) throw new HttpError(409, 'EMAIL_TAKEN');
      const { error } = await admin().auth.admin.updateUserById(user.id, { email: next, email_confirm: true });
      if (error) throw new HttpError(400, 'EMAIL_REJECTED', { detail: error.message });
      await consume(row.id);
      return { ok: true, email: next };
    }
    case 'redeem_verify': {
      const user = await authUser(req);
      await checkPassword(user.id, user.email, String(b.password ?? ''));
      const token = randomToken();
      await admin().from(`${P}auth_challenges`).update({ consumed_at: new Date().toISOString() }).eq('user_id', user.id).eq('purpose', 'redeem').is('consumed_at', null);
      const { error } = await admin().from(`${P}auth_challenges`).insert({ user_id: user.id, purpose: 'redeem', code_hash: await sha256(token), expires_at: minutes(10) });
      if (error) throw new Error(error.message);
      return { ok: true, token };
    }
    case 'two_step_set': {
      const user = await authUser(req);
      const on = b.enabled === true;
      if (!on) await checkPassword(user.id, user.email, String(b.password ?? ''));
      const { error } = await admin().from(`${P}security`).upsert({ user_id: user.id, two_step: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
      if (on) await trustDevice(user.id, str(b.device_id));
      else await admin().from(`${P}trusted_devices`).delete().eq('user_id', user.id);
      return { ok: true, enabled: on };
    }
    case 'login': {
      const email = str(b.email).toLowerCase();
      const password = String(b.password ?? '');
      if (!EMAIL_RE.test(email) || !password) throw new HttpError(400, 'CREDENTIALS_REQUIRED');
      const { data, error } = await anon().auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) {
        const m = (error?.message ?? '').toLowerCase();
        if (m.includes('confirm')) throw new HttpError(401, 'EMAIL_NOT_CONFIRMED');
        throw new HttpError(401, 'INVALID_CREDENTIALS');
      }
      const uid = data.user.id;
      if (await twoStepOn(uid) && !(await isTrusted(uid, str(b.device_id)))) {
        await throttle(uid, 'login_2fa');
        const c = await createChallenge(uid, 'login_2fa');
        await sendEmail(email, 'Your Bee Took login code', 'Confirm it is you', 'A login to your Bee Took account was attempted from a new device. Enter this code to continue.', c.code, reqId);
        return { status: 'code_required', challenge_id: c.id, email: mask(email) };
      }
      return { status: 'ok', session: session(data.session) };
    }
    case 'login_resend': {
      const { data } = await admin().from(`${P}auth_challenges`).select('user_id').eq('id', str(b.challenge_id)).eq('purpose', 'login_2fa').maybeSingle();
      const uid = (data as { user_id?: string } | null)?.user_id;
      if (!uid) throw new HttpError(400, 'CODE_EXPIRED');
      const { data: u } = await admin().auth.admin.getUserById(uid);
      const email = u.user?.email;
      if (!email) throw new HttpError(400, 'CODE_EXPIRED');
      await throttle(uid, 'login_2fa');
      const c = await createChallenge(uid, 'login_2fa');
      await sendEmail(email, 'Your Bee Took login code', 'Confirm it is you', 'Enter this code to finish logging in to Bee Took.', c.code, reqId);
      return { status: 'code_required', challenge_id: c.id, email: mask(email) };
    }
    case 'login_verify': {
      const { data } = await admin().from(`${P}auth_challenges`).select('user_id').eq('id', str(b.challenge_id)).eq('purpose', 'login_2fa').maybeSingle();
      const uid = (data as { user_id?: string } | null)?.user_id;
      if (!uid) throw new HttpError(400, 'CODE_EXPIRED');
      const row = await checkCode(uid, 'login_2fa', str(b.code), str(b.challenge_id));
      const { data: u } = await admin().auth.admin.getUserById(uid);
      const email = u.user?.email;
      if (!email) throw new HttpError(400, 'CODE_EXPIRED');
      const link = await admin().auth.admin.generateLink({ type: 'magiclink', email });
      const hashed = link.data?.properties?.hashed_token;
      if (!hashed) throw new Error('Could not start a session');
      let res = await anon().auth.verifyOtp({ token_hash: hashed, type: 'email' });
      if (res.error || !res.data.session) res = await anon().auth.verifyOtp({ token_hash: hashed, type: 'magiclink' });
      if (res.error || !res.data.session) throw new Error(res.error?.message ?? 'Could not start a session');
      await consume(row.id);
      await trustDevice(uid, str(b.device_id));
      return { status: 'ok', session: session(res.data.session) };
    }
    default:
      throw new HttpError(400, 'UNKNOWN_ACTION');
  }
}

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST_ONLY' }, 405);
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return json({ error: 'BAD_JSON' }, 400); }
  const action = str(body.action);
  console.log(JSON.stringify({ reqId, action }));
  try {
    return json(await handle(action, body, req, reqId));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    console.error(JSON.stringify({ reqId, action, error: String(e) }));
    return json({ error: 'SERVER_ERROR' }, 500);
  }
});
