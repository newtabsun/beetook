# BEETOOK — Android Migration & Final Production Architecture Requirements
## የተስተካከለ ስሪት፦ የሁልጊዜ ዋና ማጣቀሻ (v2, 2026-09-29)
ባለቤቱ ውሳኔውን ለቡድኑ ትቷል → **React Native + Expo + TypeScript** (የድር ኮድና ሎጂክ ይቀዳል፤ ከዜሮ አይጀመርም)። የንግድ ሎጂክ፣ ደህንነት፣ ክፍያ እና የማጽደቅ ደንቦች **አልተቀየሩም**።

| ዋናው (PDF) | የተስተካከለ | ምክንያት |
|---|---|---|
| Kotlin | TypeScript | የድር ኮድ/ሎጂክ እንደገና ጥቅም ላይ ይውላል |
| Jetpack Compose | React Native (Expo) components | native UI ነው፤ WebView አይደለም |
| ViewModel + Coroutines/Flow | React hooks + ትንሽ store (zustand/Context) | ተመጣጣኝ state አያያዝ |
| Repository pattern | `src/data/*Repository.ts` (TS interfaces) | ተመሳሳይ ንድፍ |
| Media3 / ExoPlayer | `expo-video` (በAndroid ላይ ExoPlayerን ይጠቀማል) | ተመሳሳይ engine |
| Canvas (105 themes) | `@shopify/react-native-skia` | native GPU rendering |
| LiveMediaProvider (Kotlin) | `LiveMediaProvider` TS interface | ክፍል 18 እንዳለ |
| ZEGOCLOUD/LiveKit Android SDK | የRN SDKዎቻቸው ግምገማ (`@livekit/react-native`፣ ZEGO RN/UIKit) — Expo dev build/config plugin ያስፈልጋል | ክፍል 4 እንዳለ፤ ማጽደቅ ያስፈልጋል |
| FCM | `expo-notifications` + FCM (Android) | ተመሳሳይ ትራንስፖርት |
| Supabase Kotlin | `@supabase/supabase-js` | ተመሳሳይ backend |
| Build | EAS Build (AAB/APK) | Expo መደበኛ መንገድ |

> ምንጭ፦ `uploads/beetook.pdf` (ወደ Markdown የተቀየረ)። ለሁሉም ቀጣይ ሥራ ይህ ሰነድ መሠረት ነው።

## 0. Mission
- Migrate the completed web product into a production-ready native Android app, preserving UI/UX, functionality, identity and UX.
- **Not a WebView conversion.**
- Live = TikTok/Poppo-style interactive live (not delayed HLS). Target ~200–500 ms end-to-end under good network; never claim 0 ms.
- Required live: host↔audience real-time A/V, request-to-join, host accept/reject/remove/ban, multiple co-host seats, real-time chat & reactions, gifts + animated gift events, coins & creator earnings, viewer/participant state, moderation/reports/blocks, reconnect & weak-network handling, PK/battle-ready.

## 1. Core rules
1. Business logic remains our code.
2. Providers supply infrastructure/media/payment primitives only.
3. Never trust the client for coin balances, gift values, earnings, admin privileges, host permissions, payment success.
4. No WebView as primary implementation.
5. Minimize third-party services; document the purpose of each.
6. Provider-specific code behind replaceable interfaces.
7. Start as modular monolith; split only when measured scale requires.
8. Inspect the web app and submit architecture proposal for approval before major coding.

## 2. Technology baseline
- **Android:** Kotlin, Jetpack Compose, AndroidX, Coroutines+Flow, ViewModel, Repository pattern, modular, lifecycle-aware media. *(የባለቤት ውሳኔ፦ React Native + Expo ተመርጧል — ROADMAP D-01 ይመልከቱ)*
- **Backend:** Supabase PostgreSQL, Auth, Realtime, Storage, Edge Functions, RLS.
- **Short video / VOD:** Cloudflare Stream + Media3/ExoPlayer.
- **Interactive live:** ZEGOCLOUD or LiveKit — evaluate both, recommend, **do not implement before approval**. Evaluate: latency, host/audience interaction, co-hosts, guest request/approval, multiple guests, PK, real-time data, Android SDK, Compose, weak network, reconnection, audience scale, recording, pricing & billing unit, 1K/10K/100K/1M cost, self-hosting, lock-in, customization, ops complexity, reliability, migration risk, regional/mobile-network suitability. Output: strengths/weaknesses of each, side-by-side table, recommendation + why, remaining uncertainty, wait for approval.
- **Push:** Firebase Cloud Messaging.

## 3. Third-party inventory (mandatory)
For every service/SDK/API: purpose, exact SDK/API, official docs, Android/backend dependency, data sent/received, auth & secrets, pricing/billing unit, cost at 1K/10K/100K/1M, rate limits, failure behavior, outage impact, lock-in, self-host alternative, migration strategy, privacy/security, legal/compliance, mandatory vs optional. Do not add a provider for convenience.

## 4. Live provider decision
- ZEGOCLOUD: interactive live streaming, low-latency A/V, host/audience, co-hosts, guest requests, PK, real-time events, chat, scale, Android SDK, Compose, reconnection, weak network, recording, moderation, analytics, pricing, volume discounts, lock-in.
- LiveKit: WebRTC rooms, low latency, co-hosts, guests, data, scalable audience, Android SDK, Compose, simulcast/dynacast, egress, Cloud pricing, self-hosting, OSS, DevOps burden, scaling, lock-in.
- Decision table rows: Target latency, Host↔audience, Co-host, Guest request, Multiple guests, PK readiness, Realtime data, Android SDK, Compose, Weak network, Reconnection, Large audience, Recording, Cost, Self-hosting, Vendor lock-in, Complexity, BEETOOK fit.
- **recommendation → owner approval → implementation.** Never silently select.

## 5. Secondary research (non-binding)
Agora, 100ms, Ant Media, AWS IVS / IVS Real-Time Stages, Dolby Millicast, Vonage Video, Daily, Cloudflare Stream WebRTC.

## 6. Media separation
- VOD: Android → Cloudflare Stream → encoding/ABR/CDN → Media3/ExoPlayer.
- Live: Android Live Room → ZEGOCLOUD or LiveKit → low-latency WebRTC.
- Supabase = source of truth for business state.

## 7. Live business logic (backend-owned)
Room creation/ownership, host/co-host permissions, guest requests, room status, bans/moderation, gifts, coins, wallet ledger, earnings, withdrawals, followers, likes, reports, blocks, notifications, analytics, audit logs. Media provider is never source of truth for money/authorization.

## 8. Live room features
create/end, host profile, join/leave, viewer count, mute, camera on/off, connection status, request to join, accept/reject, remove/ban, multiple co-hosts, chat, reactions, gifts, animated gifts, coins, earnings, follow, report/block, moderators, slow mode, spam/rate limit, reconnect, background/foreground, network recovery, recording/replay, PK-ready.

## 9. Payments (multiple rails)
- **A. NOWPayments** — crypto/USDT. Verify USDT networks, API/invoice flow, webhook verification, finality, refunds/expiration, eligibility, fees, fraud, compliance. Credit only after verified server-side confirmation.
- **B. Chapa** — Ethiopian rails. Verify the current official list (CBE, Awash, Enat, Amhara, BoA, Coopay-Ebirr, Amole, telebirr…); do not hard-code.
- **C. Stripe** — only if the BEETOOK entity is legally eligible in a supported country. Do not assume an Ethiopia-only business can. Otherwise escalate.
- **D. PayPal** — only where the merchant can receive. Do not assume Ethiopian accounts can.

## 10. Payment flow
Android → select package → backend creates order → provider → webhook → backend verifies signature/status → atomic wallet tx → coins credited → audit log → Android refreshes. **Never:** Android "success" → add coins.

## 11. Wallet ledger
Tables: wallets, wallet_transactions, coin_packages, payment_orders, payment_events, payment_provider_transactions, gifts, gift_events, creator_earnings, withdrawals, refunds, chargebacks/disputes, audit_logs. Rules: immutable ledger, atomic, idempotent, unique provider tx IDs, webhook replay protection, no client authority, auditability, reversal states, reconciliation.

## 12. Supabase core tables
profiles, videos, video_events, likes, comments, follows, notifications, devices, push_tokens, live_rooms, live_participants, live_guest_requests, live_messages, live_moderators, gifts, gift_events, wallets, wallet_transactions, coin_packages, payment_orders, payment_events, payment_provider_transactions, creator_earnings, withdrawals, refunds, reports, blocks, admin_roles, audit_logs, app_settings. FKs, constraints, indexes, timestamps, retention, RLS.

## 13. Security
RLS, server-side authz, short-lived media tokens, no service-role keys in app, rate limiting, upload validation (MIME/size/duration), anti-spam, block/report/ban enforcement, wallet idempotency, double-spend protection, webhook signature verification, audit logs, admin RBAC, secret management.

## 14. Short video
No binaries in Postgres. Cloudflare Stream for upload/encode/ABR/playback/VOD; metadata in Supabase; Media3/ExoPlayer; limited preload, minimal cache, ABR, low RAM, lifecycle, retry; cursor pagination.

**ሁኔታ (2026-10-13):**
- [x] ቪዲዮ በCloudflare Stream (ABR/HLS)፤ metadata በSupabase
- [x] መጭመቅ፦ ቪዲዮ ~2.5 Mbps (Android)፣ ፎቶ 1080px JPEG + 480px ቅድመ እይታ (አዲስ ልጥፎች)
- [x] upload retry/resume፣ progress %፣ የከሸፉ ልጥፎች በDrafts (Retry)
- [x] limited preload (የቀጣዮቹ 2 ሽፋኖች + የቀጣዮቹ 2 ቪዲዮዎች የመጀመሪያ ክፍል)፣ poster መጀመሪያ፣ MP4 disk cache (Android)
- [x] ደካማ ኔትወርክ፦ 3 ሰ. መቆም → ዝቅተኛ ጥራት (Stream + አዲስ Storage ቪዲዮዎች)፣ አማራጮች (+ "Watch downloaded videos")፣ offline/slow ባነር፣ Data Saver
- [x] ፎቶ ረጅሙ ጎን ≤1080px፤ የቆዩ ፎቶ ልጥፎች ላይ "Loading photo…" placeholder
- [x] ቪዲዮ filter/brightness/contrast/saturation በተለጠፈው ፋይል ውስጥ (Android render)
- [x] cursor pagination (ቀድሞ የነበረ)
- [ ] የቆዩ Storage ቪዲዮዎች ዝቅተኛ ቅጂ (backfill/server worker ማፅደቅ ይጠብቃል)
- [ ] ፅሁፍ/ተለጣፊ/crop በተለጠፈው ፋይል ውስጥ መቃጠል (አሁን በመጫወቻ ጊዜ ይተገበራሉ)
- [ ] upload validation በserver (MIME/መጠን/ርዝመት ≤10 ደቂቃ) — ክፍል 13

## 15. Feed
Own initial recommender: watch time, completion, replay, likes, comments, shares, follows, freshness, creator relationship, negative feedback, quality. Event collection ready for ML.

## 16. UI/UX migration
Preserve colors, typography, navigation, spacing, hierarchy, icons, animations, interactions, loading/empty/error states, identity. Adapt to small/mid/large phones, aspect ratios, Android lifecycle.

## 17. Performance
Fast cold start, fast first feed, fast live join, low buffering/memory/battery/data, smooth scroll, efficient rendering & network. Test low/mid/high devices, 3G–5G/Wi-Fi, packet loss, network switch, bg/fg, low memory, long live sessions.

## 18. Provider abstraction
`LiveMediaProvider`: connect, disconnect, joinRoom, leaveRoom, publishAudio, publishVideo, muteAudio, muteVideo, requestToJoin, acceptGuest, removeGuest, subscribe, connectionState. Exact shape follows the selected provider.

## 19. Failure strategy
Supabase / live / payment / FCM outage, network loss, media reconnect, stale room state, duplicate webhooks, delayed confirmation, partial failure. Failures must never corrupt wallets, coins, gifts, earnings, permissions.

## 20. Cost model
Estimates for 1K/10K/100K/1M users, separated by DB, storage, VOD delivery, live publishers, live viewers, realtime/chat, FCM, functions, payment fees, bandwidth, recording, monitoring. State assumptions (DAU, watch/live minutes, room size, co-hosts, bitrate, geography, payment volume). Compare billing units, not headline prices.

## 21. Phases
1 Audit web app · 2 Architecture proposal · 3 Third-party inventory · 4 ZEGOCLOUD vs LiveKit report · **5 WAIT FOR APPROVAL** · 6 Android module architecture · 7 Auth/navigation/design system · 8 Supabase/RLS · 9 Profiles/social · 10 Short video · 11 Approved live provider · 12 Chat/reactions/gifts/coins · 13 Payments · 14 FCM · 15 Moderation/admin · 16 Security hardening · 17 Performance testing · 18 Automated testing · 19 Release.

## 22. Required report before major coding
1 web architecture · 2 screens/flows · 3 API/DB/auth deps · 4 media handling · 5 reusable logic · 6 rewrite list · 7 Android structure · 8 third-party inventory · 9 ZEGO vs LiveKit · 10 secondary comparison · 11 recommended provider · 12 cost model · 13 Supabase schema · 14 RLS/security · 15 live room state machine · 16 payment architecture · 17 wallet ledger · 18 short-video architecture · 19 FCM · 20 failure/recovery · 21 testing · 22 performance · 23 migration/rollback · 24 owner decisions. **No major implementation before approval.**

## 23. Final decision rule
Compare ZEGOCLOUD and LiveKit (technical + cost + scale + UX + Android + lock-in) → recommendation → explanation → OWNER APPROVAL → implement. If evidence is inconclusive, state what is missing and ask.

## 24. Intended stack
Android (Compose/AndroidX, Media3) · Supabase (Auth, Postgres, RLS, Realtime, Storage, Edge Functions) · Cloudflare Stream · Live: ZEGOCLOUD or LiveKit (after approval) · FCM · Payments: NOWPayments, Chapa, Stripe (if eligible), PayPal (if eligible).
**Major third-party services must be approved based on evidence before implementation.**
