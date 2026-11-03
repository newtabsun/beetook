import { friendlyError } from '../../lib/errors';
import { reportFatal, setStage, withTimeout } from '../../components/CrashGuard';
// Supabase auth UI mirroring app/frontend/src/pages/Auth.tsx (login / register / forgot).
// Forgot password and the two-step login code are sent by Resend through the `auth-email` edge function.
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { consumeSignUpIntent } from '../../lib/guest';
import { LegalModal } from '../legal/LegalView';
import type { LegalKind } from '../legal/legalContent';
import { AuthEmailError, authMessage, forgotReset, forgotSend, loginResend, loginVerify, loginWithPassword } from '../../lib/authEmail';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setStage('getSession…');
    withTimeout(supabase.auth.getSession(), 'supabase.auth.getSession')
      .then(({ data }) => { setSession(data.session); setStage('ready'); })
      .catch((e) => reportFatal(e))
      .finally(() => setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading, signOut: () => supabase.auth.signOut() };
}

const O = '#FFA500';
const ic = 'rgba(255,255,255,0.4)';
const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={ic} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {d ? <Path d={d} /> : null}{children}
  </Svg>
);
const UserIcon = () => <Icon><Circle cx={12} cy={8} r={5} /><Path d="M20 21a8 8 0 0 0-16 0" /></Icon>;
const PhoneIcon = () => <Icon d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />;
const MailIcon = () => <Icon><Rect x={2} y={4} width={20} height={16} rx={2} /><Path d="m22 7-10 5L2 7" /></Icon>;
const LockIcon = () => <Icon><Rect x={3} y={11} width={18} height={11} rx={2} /><Path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>;
const KeyIcon = () => <Icon><Path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" /><Path d="m9 12 2 2 4-4" /></Icon>;
const EyeIcon = ({ off }: { off: boolean }) => off
  ? <Icon d="M9.9 4.2A10 10 0 0 1 22 12a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 1 1-4.2-4.2" />
  : <Icon><Path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><Circle cx={12} cy={12} r={3} /></Icon>;

type Mode = 'login' | 'register' | 'forgot';
type Phase = 'form' | 'code';
type Key = 'name' | 'phone' | 'email' | 'password' | 'confirm' | 'identifier' | 'code';
const EMPTY: Record<Key, string> = { name: '', phone: '', email: '', password: '', confirm: '', identifier: '', code: '' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{9,15}$/;
const RESEND_WAIT = 45;

function Field({ label, icon, error, right, value, onChange, placeholder, secure, kb, extra }: {
  label: string; icon: ReactNode; error?: string; right?: ReactNode; value: string; onChange: (v: string) => void;
  placeholder: string; secure?: boolean; kb?: 'email-address' | 'phone-pad' | 'number-pad'; extra?: ReactNode;
}) {
  const [, setFocus] = useState(false);
  return (
    <View>
      <View style={st.labelRow}><Text style={st.label}>{label}</Text></View>
      <View>
        <View style={st.iconL}>{icon}</View>
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="rgba(255,255,255,0.3)"
          secureTextEntry={secure} keyboardType={kb} autoCapitalize="none" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={[st.input, right ? { paddingRight: 44 } : null]} />
        {right ? <View style={st.iconR}>{right}</View> : null}
      </View>
      {error ? <Text style={st.err}>{error}</Text> : null}
      {extra ? <View style={{ alignItems: 'flex-end', marginTop: 8 }}>{extra}</View> : null}
    </View>
  );
}

export function AuthScreen({ onBack, session, onGuest }: { onBack?: () => void; session: ReturnType<typeof useSession>; onGuest?: () => void }) {
  const [mode, setMode] = useState<Mode>(() => (consumeSignUpIntent() ? 'register' : 'login'));
  const [phase, setPhase] = useState<Phase>('form');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Key | 'form', string>>>({});
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; email: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const set = (k: Key) => (v: string) => { setForm((f) => ({ ...f, [k]: k === 'code' ? v.replace(/\D/g, '').slice(0, 6) : v })); setErrors((e) => ({ ...e, [k]: undefined, form: undefined })); };
  const switchMode = (m: Mode) => { setMode(m); setPhase('form'); setErrors({}); setInfo(''); setChallenge(null); setCooldown(0); setForm((f) => ({ ...f, code: '', password: '', confirm: '' })); };

  const validate = () => {
    const e: Partial<Record<Key, string>> = {};
    if (mode === 'register') {
      if (!form.name.trim()) e.name = 'Name አይቀርም';
      if (!PHONE.test(form.phone.trim())) e.phone = 'Enter a valid phone number (e.g. +251 9…)';
      if (!EMAIL.test(form.email.trim())) e.email = 'Enter a valid email address';
      if (form.password.length < 6) e.password = 'Password must be 6+ characters';
      if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
    } else if (mode === 'login') {
      if (phase === 'code') {
        if (!/^\d{6}$/.test(form.code)) e.code = 'Enter the 6-digit code from your email';
      } else {
        if (!EMAIL.test(form.identifier.trim()) && !PHONE.test(form.identifier.trim())) e.identifier = 'Enter your phone number or email';
        if (form.password.length < 6) e.password = 'Password must be 6+ characters';
      }
    } else if (phase === 'form') {
      if (!EMAIL.test(form.identifier.trim())) e.identifier = 'Enter the email of your account';
    } else {
      if (!/^\d{6}$/.test(form.code)) e.code = 'Enter the 6-digit code from your email';
      if (form.password.length < 6) e.password = 'Password must be 6+ characters';
      if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Phone login resolves the account email through the profile's phone column.
  const resolveEmail = async (id: string) => {
    if (EMAIL.test(id)) return id;
    const { data } = await supabase.rpc('app_9e1318caf6_login_email', { p_phone: id.replace(/[\s-]/g, '') });
    return (data as string | null) ?? null;
  };

  const needsConsent = mode === 'register';

  const submit = async () => {
    if (!validate()) return;
    if (needsConsent && !agreed) { setErrors({ form: 'Please tick the box to accept the Terms of Service and Privacy Policy.' }); return; }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        if (phase === 'form') {
          await forgotSend(form.identifier.trim());
          setPhase('code'); setCooldown(RESEND_WAIT);
        } else {
          await forgotReset(form.identifier.trim(), form.code, form.password);
          const email = form.identifier.trim();
          switchMode('login');
          setForm((f) => ({ ...f, identifier: email }));
          setInfo('Password changed. Log in with your new password.');
        }
      } else if (mode === 'register') {
        // The handle (`user10000051`) is generated by the database trigger; the form only asks for a Name.
        const name = form.name.trim();
        const phone = form.phone.replace(/[\s-]/g, '');
        const email = form.email.trim();
        const { data, error } = await supabase.auth.signUp({ email, password: form.password, options: { data: { name, phone } } });
        if (error) throw error;
        if (data.user && data.session) onBack?.();
        else setInfo('Check your email to confirm your account, then log in.');
      } else if (phase === 'code' && challenge) {
        await loginVerify(challenge.id, form.code);
        onBack?.();
      } else {
        const email = await resolveEmail(form.identifier.trim());
        if (!email) { setErrors({ identifier: 'No account found for this phone number' }); return; }
        const r = await loginWithPassword(email, form.password);
        if (r.status === 'code_required') {
          setChallenge({ id: r.challengeId, email: r.email }); setPhase('code'); setCooldown(RESEND_WAIT);
          setForm((f) => ({ ...f, code: '' }));
        } else onBack?.();
      }
    } catch (e) {
      if (e instanceof AuthEmailError && (e.code === 'CODE_INVALID' || e.code === 'CODE_EXPIRED' || e.code === 'TOO_MANY_ATTEMPTS')) setErrors({ code: e.message });
      else setErrors({ form: authMessage(e) || friendlyError(e) });
    } finally { setBusy(false); }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true); setErrors({}); setInfo('');
    try {
      if (mode === 'forgot') await forgotSend(form.identifier.trim());
      else if (challenge) { const r = await loginResend(challenge.id); if (r.status === 'code_required') setChallenge({ id: r.challengeId, email: r.email }); }
      setCooldown(RESEND_WAIT); setInfo('A new code was sent.');
    } catch (e) {
      if (e instanceof AuthEmailError && e.code === 'WAIT') setCooldown(Number(e.extra.seconds) || RESEND_WAIT);
      setErrors({ form: authMessage(e) });
    } finally { setBusy(false); }
  };

  const guest = () => { onGuest?.(); };

  if (session.session && onBack) {
    return (
      <View style={st.root}>
        <Text style={st.h1}>Account</Text>
        <Pressable style={st.outline} onPress={() => void session.signOut()}><Text style={st.outlineT}>Log out</Text></Pressable>
        <Pressable onPress={onBack}><Text style={st.guest}>Back</Text></Pressable>
      </View>
    );
  }

  const tab = (m: Mode, label: string) => (
    <Pressable onPress={() => switchMode(m)} style={[st.tab, mode === m && st.tabOn]}>
      <Text style={[st.tabT, mode === m && st.tabTOn]}>{label}</Text>
    </Pressable>
  );

  const codePhase = phase === 'code' && mode !== 'register';
  const sentTo = mode === 'forgot' ? form.identifier.trim() : challenge?.email ?? '';
  const title = codePhase ? (mode === 'forgot' ? 'Set a new password' : 'Confirm it is you')
    : mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Join the hive' : 'Reset your password';
  const sub = codePhase ? `We sent a 6-digit code to ${sentTo}. It expires in 10 minutes.`
    : mode === 'login' ? 'Log in to keep watching and creating.' : mode === 'register' ? 'Create reels, go live, and grow your audience.' : "We'll email you a code to reset your password.";
  const primaryLabel = busy ? '' : codePhase ? (mode === 'forgot' ? 'Change password' : 'Verify and log in')
    : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Send code';
  const passRight = (
    <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={8} accessibilityLabel={showPass ? 'Hide password' : 'Show password'}><EyeIcon off={showPass} /></Pressable>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flex: 1, backgroundColor: '#000' }} contentContainerStyle={st.root} keyboardShouldPersistTaps="handled">
      <View pointerEvents="none" style={st.glow} />
      <View style={st.brandRow}>
        <Image source={require('../../../assets/logo.png')} style={{ width: 36, height: 36 }} resizeMode="contain" />
        <Text style={st.brand}>Bee<Text style={{ color: O }}>Took</Text></Text>
      </View>
      <Text style={st.h1}>{title}</Text>
      <Text style={st.sub}>{sub}</Text>
      {!codePhase && <View style={st.tabs}>{tab('login', 'Log in')}{tab('register', 'Sign up')}</View>}

      <View style={{ gap: 16 }}>
        {codePhase ? (<>
          <Field label="Verification code" icon={<KeyIcon />} placeholder="123456" kb="number-pad" value={form.code} onChange={set('code')} error={errors.code} />
          {mode === 'forgot' && (<>
            <Field label="New password" icon={<LockIcon />} placeholder="••••••••" secure={!showPass} value={form.password} onChange={set('password')} error={errors.password} right={passRight} />
            <Field label="Confirm new password" icon={<LockIcon />} placeholder="Repeat your new password" secure={!showPass} value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          </>)}
          <Pressable disabled={cooldown > 0 || busy} onPress={() => void resend()}>
            <Text style={[st.forgot, { textAlign: 'center' }, (cooldown > 0 || busy) && { opacity: 0.5 }]}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</Text>
          </Pressable>
        </>) : (<>
          {mode === 'register' && (<>
            <Field label="Name" icon={<UserIcon />} placeholder="your name" value={form.name} onChange={set('name')} error={errors.name} />
            <Field label="Phone number" icon={<PhoneIcon />} placeholder="+251 9…" kb="phone-pad" value={form.phone} onChange={set('phone')} error={errors.phone} />
            <Field label="Email" icon={<MailIcon />} placeholder="you@example.com" kb="email-address" value={form.email} onChange={set('email')} error={errors.email} />
          </>)}
          {mode !== 'register' && (
            <Field label={mode === 'forgot' ? 'Email' : 'Phone number or email'} icon={<MailIcon />} placeholder={mode === 'forgot' ? 'you@example.com' : 'you@example.com or +251 9…'}
              value={form.identifier} onChange={set('identifier')} error={errors.identifier} />
          )}
          {mode !== 'forgot' && (
            <Field label="Password" icon={<LockIcon />} placeholder="••••••••" secure={!showPass} value={form.password} onChange={set('password')} error={errors.password}
              right={passRight}
              extra={mode === 'login' ? <Pressable onPress={() => switchMode('forgot')}><Text style={st.forgot}>Forgot password?</Text></Pressable> : undefined} />
          )}
          {mode === 'register' && (
            <Field label="Confirm password" icon={<LockIcon />} placeholder="Repeat your password" secure={!showPass} value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
          )}
        </>)}
        {needsConsent && (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel="Agree to Terms of Service and Privacy Policy"
            onPress={() => { setAgreed((a) => !a); setErrors((e) => ({ ...e, form: undefined })); }} style={st.consent}>
            <View style={[st.box, agreed && st.boxOn]}>{agreed ? <Text style={st.tick}>✓</Text> : null}</View>
            <Text style={st.consentT}>
              I agree to the <Text style={st.link} onPress={() => setLegal('terms')}>Terms of Service</Text> and the <Text style={st.link} onPress={() => setLegal('privacy')}>Privacy Policy</Text>.
            </Text>
          </Pressable>
        )}
        {errors.form ? <Text style={st.err}>{errors.form}</Text> : null}
        {info ? <Text style={[st.err, { color: '#22C55E' }]}>{info}</Text> : null}
        <Pressable disabled={busy} onPress={() => void submit()} style={({ pressed }) => [st.primary, (busy || pressed) && { opacity: 0.8 }]}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={st.primaryT}>{primaryLabel}</Text>}
        </Pressable>
        {codePhase && <Pressable onPress={() => switchMode('login')}><Text style={st.guest}>Cancel</Text></Pressable>}
        {mode === 'forgot' && !codePhase && <Pressable onPress={() => switchMode('login')}><Text style={st.guest}>Back to login</Text></Pressable>}
      </View>

      <Pressable onPress={() => void guest()}><Text style={[st.guest, { marginTop: 32 }]}>Continue as guest</Text></Pressable>
      <LegalModal kind={legal} onClose={() => setLegal(null)} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40, backgroundColor: '#000', flexGrow: 1 },
  glow: { position: 'absolute', top: -96, alignSelf: 'center', width: 256, height: 256, borderRadius: 128, backgroundColor: 'rgba(255,165,0,0.12)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  brand: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  h1: { color: '#fff', fontSize: 30, fontWeight: '800', lineHeight: 36 },
  sub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4, marginBottom: 24 },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, padding: 4, marginBottom: 24 },
  tab: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  tabOn: { backgroundColor: O },
  tabT: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  tabTOn: { color: '#000', fontWeight: '800' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  forgot: { color: O, fontSize: 12, fontWeight: '700' },
  input: { height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', paddingLeft: 36, paddingRight: 12, color: '#fff', fontSize: 14 },
  iconL: { position: 'absolute', left: 12, top: 14, zIndex: 1 },
  iconR: { position: 'absolute', right: 12, top: 14, zIndex: 1 },
  err: { color: '#F87171', fontSize: 12, fontWeight: '500', marginTop: 4 },
  primary: { height: 44, borderRadius: 12, backgroundColor: O, alignItems: 'center', justifyContent: 'center' },
  primaryT: { color: '#000', fontSize: 14, fontWeight: '800' },
  outline: { marginTop: 16, height: 40, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  outlineT: { color: '#fff', fontWeight: '600' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: O, borderColor: O },
  tick: { color: '#000', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  consentT: { flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 18 },
  link: { color: O, fontWeight: '700', textDecorationLine: 'underline' },
  guest: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
