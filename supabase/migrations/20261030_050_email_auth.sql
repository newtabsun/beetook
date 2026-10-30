-- 050 · Resend-backed email codes: forgot password, change email, password-confirmed redeem, two-step login.
--
-- All tables are service-role only (the `auth-email` edge function owns them); clients may only READ
-- their own two-step flag. Redeem now needs a short-lived, single-use token that the edge function
-- issues after the account password has been verified, so the check cannot be skipped from the app.
-- Idempotent (safe to run more than once).

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL,            -- forgot | email_change | login_2fa | redeem | pw_fail
  code_hash text NOT NULL DEFAULT '',
  new_email text,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_9e1318caf6_auth_challenges_idx
  ON public.app_9e1318caf6_auth_challenges (user_id, purpose, created_at DESC);
ALTER TABLE public.app_9e1318caf6_auth_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_9e1318caf6_auth_challenges FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_security (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  two_step boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_9e1318caf6_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_9e1318caf6_security FROM anon, authenticated;
GRANT SELECT ON public.app_9e1318caf6_security TO authenticated;
DROP POLICY IF EXISTS security_own_read ON public.app_9e1318caf6_security;
CREATE POLICY security_own_read ON public.app_9e1318caf6_security
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.app_9e1318caf6_trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_9e1318caf6_trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_9e1318caf6_trusted_devices FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_9e1318caf6_user_id_by_email(p_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_email_taken(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(p_email)))
$$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_email_taken(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_user_id_by_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_email_taken(text) TO service_role;

-- Redeem: the client may only call the *_secure variant, which burns one password-confirmation token.
CREATE OR REPLACE FUNCTION public.app_9e1318caf6_redeem_create_secure(
  p_method text, p_coins bigint, p_fields jsonb, p_idempotency text, p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  cid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Please sign in first'; END IF;
  -- Repeating an already accepted request returns the original one (no second confirmation needed).
  IF coalesce(trim(p_idempotency), '') <> '' AND EXISTS (
       SELECT 1 FROM app_9e1318caf6_redeem_requests WHERE user_id = me AND idempotency_key = p_idempotency) THEN
    RETURN public.app_9e1318caf6_redeem_create(p_method, p_coins, p_fields, p_idempotency);
  END IF;
  UPDATE app_9e1318caf6_auth_challenges SET consumed_at = now()
   WHERE id = (SELECT id FROM app_9e1318caf6_auth_challenges
                WHERE user_id = me AND purpose = 'redeem' AND consumed_at IS NULL AND expires_at > now()
                  AND code_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
                LIMIT 1 FOR UPDATE)
  RETURNING id INTO cid;
  IF cid IS NULL THEN RAISE EXCEPTION 'PASSWORD_REQUIRED'; END IF;
  -- A validation error below rolls this whole transaction back, so the token is not lost.
  RETURN public.app_9e1318caf6_redeem_create(p_method, p_coins, p_fields, p_idempotency);
END $$;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_redeem_create_secure(text, bigint, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_9e1318caf6_redeem_create_secure(text, bigint, jsonb, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.app_9e1318caf6_redeem_create(text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
