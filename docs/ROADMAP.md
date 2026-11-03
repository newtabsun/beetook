# BEETOOK — የAndroid ፍልሰት የደረጃ በደረጃ እቅድ (ROADMAP)
> መሠረት፦ `docs/beetook-requirements.md` (ክፍል 21/22)። እያንዳንዱ ደረጃ ከማለቁ በፊት lint/build/ሙከራ ማለፍ አለበት።

## አሁን ያለው ሁኔታ (ኦዲት ማጠቃለያ)
- የድር መተግበሪያ፦ React + Vite + shadcn/ui (`app/frontend`)፣ ~24,000 መስመሮች።
- ዋና ክፍሎች፦ Shell/navigation፣ VideoCard feed፣ MediaEditor (የፎቶ ስላይድሾው 105 ገጽታዎች — `themes105/engine.js` 2,854 መስመር Canvas)፣ VideoTimeline/kinetic፣ RecordCamera፣ LiveRoomView (1,634 መስመር)፣ Car Racing (`public/games/car-racing.html`)፣ Profile/Notes/VipExtras/Wallet/Withdraw/Settings፣ Groups፣ Marketplace፣ Inbox፣ Auth።
- ዳታ፦ ሞክ (`data/mock.ts`) + localStorage (`beetook_notes_v1`፣ wallet፣ wagers)። ህትመት simulation ብቻ።

## ደረጃ 0 — መሠረት (የአሁኑ ዙር)
- [x] PDF → `docs/beetook-requirements.md`
- [x] ይህ ROADMAP
- [x] Expo SDK 57 + TypeScript ፕሮጀክት በ`app/mobile` ተፈጥሯል (create-expo-app)፤ brand assets ተቀድተዋል።
- [x] Design tokens (`src/theme.ts`)፣ ቀላል tab shell፣ Profile + Follow us (SocialIcon — ከድሩ ተመሳሳይ SVG)፣ Notes (AsyncStorage `beetook_notes_v1`፣ 7 ቀለሞች፣ bold/underline፣ 2-column FlatList፣ edit/delete) ተዛውረዋል።
- ማሳሰቢያ፦ RN rich-text ስለሌለ የማስታወሻ ቅርጸት በየማስታወሻው ነው (ከድሩ በቃላት ደረጃ ቅርጸት ይለያል)።

## ደረጃ 1 — Design system እና Navigation
ቀለሞች/ፊደላት/ክፍተት ከ`index.css`/Tailwind tokens ወደ RN theme፤ Splash (expo-splash-screen)፤ Bottom tabs + stacks (expo-router)፤ አዶዎች (lucide-react-native)።

## ደረጃ 2 — Profile፣ Notes፣ Follow us
Profile menu፣ NotesSheet (AsyncStorage `beetook_notes_v1`፣ 7 ቀለሞች፣ bold/underline)፣ SocialIcon (react-native-svg)፣ VipExtras፣ Settings።

## ደረጃ 3 — Feed እና የፖስት ፍሰት
VideoCard feed በFlashList/FlatList (virtualization፣ ውስን preload)፣ expo-video፤ Edit → Details → Review፣ draft፣ simulated progress፣ scheduling።

## ደረጃ 4 — Media editors
ፎቶ ስላይድሾው፦ `engine.js` Canvas 2D → `@shopify/react-native-skia` (105 ገጽታዎች፣ duration፣ transitions)። ቪዲዮ አርታኢ፦ timeline/kinetic፣ expo-camera ለRecordCamera።

## ደረጃ 5 — Live rooms እና ጨዋታዎች
LiveRoomView UI (ሞክ)፣ የጨዋታ ካርዶች፣ Car Racing ወደ Skia/Reanimated native game loop፣ wager/payout ከመሳሪያ balance ጋር።

## ደረጃ 6 — Wallet፣ Groups፣ Marketplace፣ Inbox፣ Auth UI (ሞክ)

## ደረጃ 7 — የሪፖርት ደረጃ (PDF ክፍል 22) — **ከዋና backend ኮድ በፊት**
የሶስተኛ ወገን ዝርዝር፣ ZEGOCLOUD vs LiveKit ንጽጽር + ሰንጠረዥ + ምክር፣ ሁለተኛ ደረጃ ንጽጽር (Agora, 100ms, IVS…)፣ 1K/10K/100K/1M የወጪ ሞዴል፣ Supabase schema + RLS፣ live room state machine፣ payment/ledger አርክቴክቸር፣ FCM፣ failure strategy፣ ሙከራና አፈጻጸም። → **የባለቤት ማጽደቅ**

## ደረጃ 8–19 (ከማጽደቅ በኋላ)
8 Supabase/RLS · 9 Profiles/social · 10 Cloudflare Stream + ፕሌየር · 11 የጸደቀው live provider (`LiveMediaProvider` interface ጀርባ) · 12 Chat/gifts/coins (server-owned ledger) · 13 ክፍያዎች (NOWPayments, Chapa, Stripe/PayPal ብቁ ከሆኑ ብቻ፤ webhook-verified ብቻ) · 14 FCM · 15 Moderation/admin · 16 Security · 17 Performance · 18 Automated tests · 19 Release.

## የባለቤት ማጽደቅ የሚያስፈልጋቸው ውሳኔዎች / ግልጽ ያልሆኑ ጉዳዮች
- **D-01 ✅ ተፈቷል፦** React Native + Expo (requirements v2 ሰንጠረዥ)።
- **D-02 ✅ ተፈቷል፦** `app/mobile` በcreate-expo-app ተፈጥሯል። ማሳሰቢያ፦ የAtoms App Viewer ይህን ፕሮጀክት አያሳይም፤ በስልክ Expo Go (`npx expo start`) ወይም EAS Build APK መሞከር ያስፈልጋል።
- **D-03 "100% ተመሳሳይ"፦** Canvas-based 105 ገጽታዎችና HTML Car Racing በnative ሙሉ በሙሉ እንደገና መጻፍ ያስፈልጋቸዋል (Skia)፤ ጊዜያዊ WebView fallback ለጨዋታው ተቀባይነት አለው?
- **D-04 Live provider፦** ZEGOCLOUD vs LiveKit — ከደረጃ 7 ሪፖርት በኋላ።
- **D-05 Stripe/PayPal ብቁነት፦** የBEETOOK ሕጋዊ አካል በየትኛው አገር ተመዝግቧል?
- **D-06 NOWPayments፦** የትኞቹ USDT networks (TRC20/ERC20/BEP20) ይፈለጋሉ?
- **D-07 Backend፦** PDF Supabase ይጠይቃል — የSupabase ፕሮጀክት ማን ይፈጥራል/ያስተዳድራል?
- **D-08 Archive፦** ያልተጠቀሙ ፋይሎች (root `shot_*.png`, `*.py`, `measure.py`, blog) ወደ `_archive/` ይዛወሩ — ከRN ፍልሰት ጋር አብሮ ይሠራል።

## ሁኔታ ዝማኔ (2026-09-29, T5b)
- ✅ ደረጃ 1–3 (በከፊል)፦ Splash፣ 4 tabs (Home/Live/＋/Profile)፣ Feed (vertical paging, like/save/comments, photo slideshow posts)፣ የፖስት ፍሰት Edit→Details→Review፣ drafts፣ schedule (Now/+1h/+1 day)፣ simulated posting progress።
- ✅ ደረጃ 5 (በከፊል)፦ Live rooms (ምድቦች፣ ክፍል)፣ 9 የጨዋታ ካርዶች፣ Car Racing native (wager ×2 ከbalance ይቀነሳል፣ ሲያልቅ pot ይመለሳል፣ በቂ balance ማጣራት)።
- ⏳ ደረጃ 4፦ 105 themes engine (engine.js → Skia port) እና video editor (trim/filters) — ገና።
- ⏳ ደረጃ 6፦ Wallet/Groups/Marketplace/Inbox/Auth UI — ገና።

## T5c ሁኔታ (2026-09-29)
- ✅ 105 themes፦ `app/mobile/src/features/editor/themes105/` — web `engine.js` ሳይቀየር በSkia Canvas2D adapter ይሠራል፤ ቆይታ/photo እና transitions።
- ✅ Video editor፦ trim in/out፣ speed፣ mute (expo-video)፤ edit ከpost/draft ጋር ይቀመጣል።
- ✅ Wallet (recharge/withdraw ተዘግተዋል — D-05/D-06)፣ Groups፣ Market (checkout የለም)፣ Inbox (chat + activity)፣ Auth (local session — D-07)።
- ⏳ በመሣሪያ ላይ ማሄድ/APK ግንባታ፣ የadapter ምስላዊ ንጽጽር ከድር ጋር።
