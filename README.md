# Beetook (Bee Took)

Live-streaming / social app built with Expo (React Native + Web) and Supabase.

## Stack
- Expo SDK 57 / React Native 0.86 (Android + Web via Metro)
- Supabase (Auth, Postgres, Edge Functions)
- LiveKit (live video), Resend (auth emails)

## Local development
```bash
pnpm install
pnpm web        # web dev server
pnpm android    # native Android build (needs Android SDK)
```

## Deploy the web app on Vercel
1. Push this repo to GitHub, then **Add New -> Project** in Vercel and import it.
2. Framework Preset: **Other** (settings are read from `vercel.json`):
   - Install: `pnpm install --no-frozen-lockfile`
   - Build: `npx expo export --platform web`
   - Output: `dist`
3. Deploy.

## Supabase
- SQL migrations: `supabase/migrations/` (apply in filename order).
- Edge functions: `supabase/functions/` (`auth-email`, `verify-purchase`, ...).
  Deploy with `supabase functions deploy <name>`.
- Function secrets (`supabase secrets set ...`): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
  (a sender on a domain verified in Resend), plus provider keys used by `verify-purchase`.
- Supabase Dashboard -> Authentication -> URL Configuration: set **Site URL** and
  **Redirect URLs** to your Vercel domain.
- The Supabase URL and anon (public) key live in `src/lib/supabase.ts`. Never commit the `service_role` key.

## Android build
```bash
eas build -p android --profile preview
```
