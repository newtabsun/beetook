# Google Play ክፍያ — ከዜሮ የማዋቀር መመሪያ (Bee Took)

Package name: `com.beetook.app` · ተመን: **$1 = 1,600 COIN** · Android ውስጥ ግዢ በGoogle Play ብቻ።

## 1. ፓኬጆች (16 ፣ ከ $0.99 እስከ $399.99)
ሁሉም **One-time product (Consumable)** ናቸው። Product ID በትክክል መመሳሰል አለበት፤ ዋጋው USD።

| Product ID | ዋጋ | COIN |
|---|---|---|
| coins_099 | $0.99 | 1,584 |
| coins_199 | $1.99 | 3,184 |
| coins_299 | $2.99 | 4,784 |
| coins_499 | $4.99 | 7,984 |
| coins_999 | $9.99 | 15,984 |
| coins_1499 | $14.99 | 23,984 |
| coins_1999 | $19.99 | 31,984 |
| coins_2499 | $24.99 | 39,984 |
| coins_4999 | $49.99 | 79,984 |
| coins_7499 | $74.99 | 119,984 |
| coins_9999 | $99.99 | 159,984 |
| coins_14999 | $149.99 | 239,984 |
| coins_19999 | $199.99 | 319,984 |
| coins_24999 | $249.99 | 399,984 |
| coins_29999 | $299.99 | 479,984 |
| coins_39999 | $399.99 | 639,984 |

## 2. Play Console (play.google.com/console)
1. **Developer account** አዘጋጅ (አንድ ጊዜ $25) እና Merchant (payments) profile አሟላ፤ Setup → Payments profile።
2. **Create app** → Bee Took፣ Package `com.beetook.app` (EAS የሚያመነጨው ቁልፍ በመጀመሪያ መጫን አለበት)።
3. መተግበሪያውን AAB (`eas build -p android --profile production`) ወደ **Internal testing** ስቀል። ቢያንስ አንድ ጊዜ የሰቀለ ቅጂ ከሌለ የIn-app products አይታዩም። versionCode = 45።
4. **Monetize → Products → In-app products → Create product**: ለእያንዳንዱ ከላይ ያለው ID አንዱን ፍጠር። Name፣ Description ሙላ፣ **Price** ሲሞላ USD ን ምረጥ (ሌሎች አገሮች በራስ ይቀየራሉ) → **Activate**። የGoogle ዋጋ ከ.99 ማለቅ ይፈቅዳል፤ ከ$0.99 በታች እና ከ$399.99 በላይ አትስጥ።
5. **Setup → API access** (ወይም Users and permissions) → Google Cloud project ጋር አገናኝ → **Create service account** → Google Cloud ውስጥ JSON key አውርድ። ከዚያ Play Console ውስጥ ያንን የservice account ኢሜይል **Invite user** አድርግ፤ ፈቃዶች: *View app information*, *View financial data*, *Manage orders and subscriptions*።
6. **License testing** (Setup → License testing): የራስህን Gmail ጨምር። ሙከራ በነዚህ መለያዎች ብቻ፣ ገንዘብ አይቆረጥም።
7. **Real-time developer notifications** (Monetize → Monetization setup): Google Cloud ውስጥ Pub/Sub topic ፍጠር፣ `google-play-developer-notifications@system.gserviceaccount.com` ን Publisher አድርግ፣ ከዚያ Push subscription ፍጠር፤ Endpoint: `https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/google-play-rtdn?key=<GOOGLE_PLAY_RTDN_SECRET>`። Topic name ን Play Console ውስጥ ሙላ፣ Notification type: *All notifications*።

## 3. Supabase (ያንተ ተግባር ፣ እኔ ማስቀመጥ አልቻልኩም)
Secrets (Project Settings → Edge Functions → Secrets):
```
PAYMENTS_GOOGLE_PLAY_MODE = sandbox        # ሙከራ ሲያልቅ: live
GOOGLE_PLAY_SERVICE_ACCOUNT = <የJSON ፋይሉ ሙሉ ይዘት>
GOOGLE_PLAY_PACKAGE_NAME = com.beetook.app
GOOGLE_PLAY_RTDN_SECRET = <ረጅም የዘፈቀደ ጽሑፍ>
```
Deploy (Supabase CLI):
```bash
cd app/mobile
supabase functions deploy verify-purchase --project-ref klxynisbmxqmyszkdrxj
supabase functions deploy google-play-rtdn --no-verify-jwt --project-ref klxynisbmxqmyszkdrxj
supabase functions deploy chapa-webhook usdt-verify payout --project-ref klxynisbmxqmyszkdrxj   # ለዌብ (አማራጭ)
```
Database migration (046) አስቀድሞ በፕሮጀክቱ ላይ ተተግብሯል። ለሌላ ዳታቤዝ ከፈለግህ `supabase/migrations/20261029_046_google_play_usd.sql` አሂድ።

## 4. ሙከራ → ማምረት
1. `eas build -p android --profile preview` ወይም Internal testing ቅጂ ጫን (tester መለያ)።
2. Wallet → Buy coins → ፓኬጅ ምረጥ → Pay። COIN በPurchased balance ይጨመራል፤ History ውስጥ "Coin purchases"።
3. ሙከራ፦ ሁለት ጊዜ ተመሳሳይ ፓኬጅ ግዛ፤ ግዢ ሲሰርዝ ምንም አይጨመርም፤ ኢንተርኔት ጠፍቶ ከከፈልህ በኋላ Wallet ሲከፈት COIN ይመለሳል።
4. ሁሉም ሲሳካ `PAYMENTS_GOOGLE_PLAY_MODE=live` አድርግ እና AAB ወደ Production አውጣ (Live ውስጥ test ግዢ ተቀባይነት የለውም)።
5. Refund ሙከራ፦ Play Console → Order management ውስጥ ግዢ Refund አድርግ → RTDN COIN ን ይመልሳል (Orders ውስጥ status `refunded`)።
