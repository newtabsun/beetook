# Bee Took — የGoogle Play ክፍያ ሙሉ መመሪያ (ለጀማሪ፣ ከዜሮ እስከ መጨረሻ)

**አፕ፦** Bee Took · **Package name፦** `com.beetook.app` · **Supabase ፕሮጀክት፦** `klxynisbmxqmyszkdrxj`
**ተመን፦** $1 = 1,600 COIN · **Android ውስጥ ግዢ፦** በGoogle Play ብቻ (Chapa እና USDT ለዌብ ብቻ)

---

## 0. በመጀመሪያ ማወቅ ያለብህ (ማጠቃለያ)

### እኔ (Alex) የጨረስኩት — እንደገና ምንም ኮድ አትጻፍ
| ተግባር | ሁኔታ |
|---|---|
| 16 ፓኬጆች ($0.99 – $399.99) በSupabase ዳታቤዝ ውስጥ | ✅ ተተግብሯል (ቀጥታ ዳታቤዝ ላይ) |
| COIN ስሌት ($1 = 1,600) በሰርቨር | ✅ ተፈትኗል (ሁሉም ሙከራ PASS) |
| ግዢ ማረጋገጫ ከGoogle ጋር (Edge Function) | ✅ ኮድ ተጽፏል፤ **አንተ deploy ታደርጋለህ** (ክፍል 5) |
| ተመላሽ (refund) ሲሆን COIN መቀነስ | ✅ ዳታቤዝ ላይ ተተግብሯል + Edge Function ኮድ ተጽፏል |
| የሞባይል አፕ ኮድ (Wallet ስክሪን፣ ግዢ፣ ያልተመዘገበ ግዢ መመለስ) | ✅ ተጠናቋል፣ `tsc` ያለ ስህተት |
| `versionCode` | ✅ 45 |

### አንተ የምታደርገው (በዚህ ቅደም ተከተል)
1. Google Play Developer መለያ + Payments profile (ክፍል 1)
2. አፕ በPlay Console መፍጠር (ክፍል 2)
3. 16 ፓኬጆች መፍጠር (ክፍል 3)
4. Service Account መፍጠር እና ፈቃድ መስጠት (ክፍል 4)
5. Supabase ላይ Secrets + 2 Edge Functions deploy (ክፍል 5)
6. Pub/Sub (ተመላሽ እና ራስ-ሰር ክሬዲት) ማገናኘት (ክፍል 6)
7. አፕ build ማድረግ እና Play ላይ መጫን (ክፍል 7)
8. መሞከር፣ ከዚያ Live ማድረግ (ክፍል 8 እና 9)

> ⚠️ **ወሳኝ ማስጠንቀቂያ:** Google Play ግዢ **ከPlay Store በተጫነ አፕ ላይ ብቻ** ይሰራል። ከAPK ፋይል በቀጥታ (sideload) የጫንከው አፕ ላይ "Item unavailable" ወይም "Google Play is not available" ይመጣል። ለሙከራ **Internal testing** መንገድን ተጠቀም (ክፍል 7)።

---

## 1. Google Play Developer መለያ

1. ወደ https://play.google.com/console ግባ። በGmail ግባ።
2. መለያ ከሌለህ **Create developer account** → አይነት ምረጥ (Personal ወይም Organization)። የአንድ ጊዜ ክፍያ **$25**።
3. ማንነት ማረጋገጫ (መታወቂያ/ፓስፖርት) ያስፈልጋል፤ ማረጋገጫው ከጥቂት ሰዓታት እስከ ቀናት ሊወስድ ይችላል።
4. **Payments profile (የክፍያ መለያ)** አሟላ፦ Play Console → ግራ ሜኑ **Setup** → **Payments profile**። የባንክ ሂሳብ፣ ሙሉ ስም፣ አድራሻ፣ የግብር መረጃ ሙላ። **ይህ ካልተሟላ ገንዘብ ማግኘት አትችልም፤ ምርቶችም ላይፈጠሩ ይችላሉ።**

> ማስታወሻ፦ በግል (Personal) መለያ ከ2023 መጨረሻ በኋላ ከተከፈተ፣ አፕ ወደ **Production** ለማውጣት Google **ቢያንስ 12 ሞካሪዎች ለ14 ቀናት በClosed testing** እንዲሞክሩ ይጠይቃል። በOrganization መለያ ይህ ላይኖር ይችላል። Internal testing (ክፍል 7) ግን ይህን አያስፈልገውም።

---

## 2. አፕን በPlay Console መፍጠር

1. Play Console → **Create app**።
2. ሙላ፦
   - **App name:** `Bee Took`
   - **Default language:** English (United States) ወይም የምትመርጠው
   - **App or game:** App
   - **Free or paid:** Free
   - ሁለቱን ማረጋገጫዎች (Declarations) ምልክት አድርግ → **Create app**።
3. **Package name** በአፑ ውስጥ `com.beetook.app` ነው፤ Play Console የሚወስደው ከመጀመሪያው የሚሰቅለው AAB ፋይል ነው (ክፍል 7)።
4. Dashboard ላይ ያሉትን "Set up your app" ተግባራት (Privacy policy, App access, Ads, Content rating, Target audience, Data safety) ቀስ በቀስ ሙላ። ለInternal testing ሁሉንም አትፈልግም፣ ለProduction ግን ያስፈልጋሉ።

---

## 3. 16 ፓኬጆችን መፍጠር (One-time products)

> ⚠️ **Product ID ፊደል በፊደል መመሳሰል አለበት።** አንድ ፊደል ቢለያይ ግዢ አይሰራም። ከታች ያለውን ኮፒ አድርግ። ከመፍጠርህ በፊት መጀመሪያ ክፍል 7 ላይ AAB መስቀል (ቢያንስ አንዴ) አለብህ፣ ያለበለዚያ **Monetize** ሜኑ ሊቆለፍ ይችላል።

**መንገድ፦** Play Console → አፕህን ምረጥ → ግራ ሜኑ **Monetize with Play** → **Products** → **In-app products** → **Create product**።

ለእያንዳንዱ ፓኬጅ፦
- **Product ID:** ከታች ካለው ሰንጠረዥ (ከተፈጠረ በኋላ ሊቀየር አይችልም!)
- **Name:** ምሳሌ `1,584 Coins`
- **Description:** ምሳሌ `Bee Took coins pack`
- **Price (ዋጋ):** **Set price** → **USD** ላይ ትክክለኛውን ዋጋ ጻፍ → ሌሎች አገሮች በራስ ይሰላሉ (ኢትዮጵያ ከሆነ ETB ወይም USD ሊያሳይ ይችላል)
- **Save** ከዚያ **Activate** (ንቁ አድርግ)

| # | Product ID (ኮፒ አድርግ) | ዋጋ (USD) | COIN |
|---|---|---|---|
| 1 | `coins_099` | 0.99 | 1,584 |
| 2 | `coins_199` | 1.99 | 3,184 |
| 3 | `coins_299` | 2.99 | 4,784 |
| 4 | `coins_499` | 4.99 | 7,984 |
| 5 | `coins_999` | 9.99 | 15,984 |
| 6 | `coins_1499` | 14.99 | 23,984 |
| 7 | `coins_1999` | 19.99 | 31,984 |
| 8 | `coins_2499` | 24.99 | 39,984 |
| 9 | `coins_4999` | 49.99 | 79,984 |
| 10 | `coins_7499` | 74.99 | 119,984 |
| 11 | `coins_9999` | 99.99 | 159,984 |
| 12 | `coins_14999` | 149.99 | 239,984 |
| 13 | `coins_19999` | 199.99 | 319,984 |
| 14 | `coins_24999` | 249.99 | 399,984 |
| 15 | `coins_29999` | 299.99 | 479,984 |
| 16 | `coins_39999` | 399.99 | 639,984 |

**ማረጋገጫ:** 16ቱም በዝርዝሩ ውስጥ ሁኔታቸው **Active** መሆኑን አይ። አንዱ ከጠፋ ያ ፓኬጅ ሲመረጥ አፑ "Product … is not set up in Google Play Console yet" ይላል።

> ምክር፦ ለኢትዮጵያ ተጠቃሚዎች Google ዋጋውን በአገር ምንዛሬ ያሳያል። COIN የሚጨመረው ሁልጊዜ በUSD ዋጋ ($1 = 1,600) መሠረት ነው።

---

## 4. Service Account (ሰርቨሩ ከGoogle ጋር እንዲነጋገር)

ሰርቨራችን ግዢው እውነተኛ መሆኑን Google ን የሚጠይቅበት "ሮቦት መለያ" ነው።

### 4.1 Google Cloud ውስጥ መፍጠር
1. https://console.cloud.google.com ግባ (ተመሳሳይ Gmail)።
2. ከላይ ፕሮጀክት መምረጫ → **New Project** → ስም `beetook-billing` → **Create**። ፕሮጀክቱ እንደተመረጠ አረጋግጥ።
3. **API አንቃ:** ፍለጋ ላይ `Google Play Android Developer API` ጻፍ → ምረጥ → **Enable**።
4. ግራ ሜኑ ☰ → **IAM & Admin** → **Service Accounts** → **Create service account**።
   - **Name:** `beetook-billing`
   - **Create and continue** → ሚና (Role) አትስጥ፣ **Done**።
5. የተፈጠረውን ሰርቪስ አካውንት ጠቅ አድርግ → ትር **Keys** → **Add key** → **Create new key** → **JSON** → **Create**። አንድ `.json` ፋይል ኮምፒውተርህ ላይ ይወርዳል።
   - 🔒 **ይህ ፋይል ሚስጥር ነው።** ለማንም አትላክ፣ በGitHub አትጫን፣ በስክሪንሾት አታጋራ።
6. የሰርቪስ አካውንቱን **ኢሜይል** ኮፒ አድርግ (ምሳሌ `beetook-billing@beetook-billing.iam.gserviceaccount.com`)።

### 4.2 በPlay Console ፈቃድ መስጠት
1. Play Console መነሻ ገጽ (ከአፕ ውጭ) → ግራ ሜኑ **Users and permissions** → **Invite new users**።
2. **Email address** ላይ የሰርቪስ አካውንቱን ኢሜይል ለጥፍ።
3. **App permissions** ትር → **Add app** → Bee Took ምረጥ → **Apply**።
4. ፈቃዶች ምልክት አድርግ (Account/App permissions)፦
   - ✅ **View app information and download bulk reports (read-only)**
   - ✅ **View financial data, orders, and cancellation survey responses**
   - ✅ **Manage orders and subscriptions**
5. **Invite user** → **Send invite**። (ወዲያውኑ ንቁ ይሆናል፤ ግን ለማረጋገጥ እስከ ~24–36 ሰዓት ሊወስድ ይችላል።)

> "Google auth failed" ወይም "401/403" ከመጣ፦ ፈቃዱ ገና ስላልተሰራጨ ነው፤ ጥቂት ሰዓታት ጠብቅ ወይም ሦስቱ ፈቃዶች መመረጣቸውን እና API መንቃቱን እንደገና አረጋግጥ።

---

## 5. Supabase ላይ Secrets እና Edge Functions

Supabase Dashboard፦ https://supabase.com/dashboard/project/klxynisbmxqmyszkdrxj

### 5.1 ዳታቤዝ — አስቀድሞ ተጠናቋል ✅
Migration 046 ዳታቤዝ ላይ ተተግብሯል። **ምንም ማድረግ አያስፈልግህም።** (ለማረጋገጥ ብቻ፦ **SQL Editor** → ይህን ሩጥ፦)

```sql
select jsonb_array_length(value->'google_play') as pack_count
from app_9e1318caf6_wallet_config where key = 'coin_packs';
```
ውጤቱ `16` መሆን አለበት።

### 5.2 ሚስጥር ቁጥር (RTDN secret) ፍጠር
ማንኛውንም ረጅም የዘፈቀደ ጽሑፍ ፍጠር (ቢያንስ 32 ፊደል፣ ፊደል እና ቁጥር ብቻ)። ምሳሌ፦
```
k8Qz2VmX9pLr4TnW7yHb3JdF6sAc1EgU
```
> ይህን **የራስህን** ጻፍ (ምሳሌውን አትጠቀም)። አስቀምጠው — በክፍል 5.3 እና 6 ያስፈልጋል።

### 5.3 Secrets ማስገባት
**Edge Functions** → **Secrets** (ወይም Project Settings → Edge Functions → Secrets) → **Add new secret**። አራቱን አንድ በአንድ ጨምር፦

| Name (በትክክል ኮፒ) | Value |
|---|---|
| `PAYMENTS_GOOGLE_PLAY_MODE` | መጀመሪያ `sandbox`፣ ሙከራ ሲያልቅ `live` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | ከክፍል 4.1 ያወረድከው `.json` ፋይል **ሙሉ ይዘት** (ፋይሉን በNotepad ክፈት → ሁሉንም ምረጥ → ኮፒ → ለጥፍ፤ `{` ከሚጀምረው እስከ `}` ድረስ) |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.beetook.app` |
| `GOOGLE_PLAY_RTDN_SECRET` | ከክፍል 5.2 ያለው የራስህ ሚስጥር |

> ✅ `SUPABASE_URL` እና `SUPABASE_SERVICE_ROLE_KEY` Supabase በራሱ ያስገባል፤ አንተ አትጨምርም።

### 5.4 Edge Function 1፦ `verify-purchase`
(ይህ የአፑን ግዢ ያረጋግጣል እና COIN ይጨምራል።)

1. Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**።
2. **Function name:** `verify-purchase` (በትክክል)።
3. በአርታዒው ውስጥ ያለውን ኮድ ሁሉ ሰርዝ።
4. ይህን ፋይል ክፈት፣ ሁሉንም ኮፒ አድርግ፣ ለጥፍ፦
   **`assets/documents/verify-purchase.ts.txt`** (በ Assets ውስጥ ትገኛለህ — 468 መስመር)
5. **Verify JWT** — ✅ **ON ሆኖ ይቀራል** (ነባሪ)።
6. **Deploy function** ጠቅ አድርግ።

### 5.5 Edge Function 2፦ `google-play-rtdn`
(ይህ Google ራሱ የሚልከውን ማሳወቂያ ተቀብሎ COIN ይጨምራል/ይቀንሳል።)

1. **Deploy a new function** → **Via Editor**።
2. **Function name:** `google-play-rtdn` (በትክክል)።
3. ኮዱን ሰርዝ እና **`assets/documents/google-play-rtdn.ts.txt`** ሙሉ ይዘት ለጥፍ።
4. ⚠️ **Verify JWT — ❌ OFF አድርግ።** (Google JWT ስለማይልክ ካልጠፋ ሁሌም 401 ይመጣል። ደህንነቱ በ`?key=` ሚስጥር ይጠበቃል።)
5. **Deploy function**።

### 5.6 ማረጋገጫ — ተግባራቱ ሕያው ናቸው?
**Edge Functions** ገጽ ላይ ሁለቱም **Active** ይታያሉ። ለፈጣን ሙከራ **SQL Editor** ሳይሆን የአፑን Wallet ክፈት (ክፍል 8)።

### 5.7 (አማራጭ) በCLI deploy ማድረግ
Supabase CLI ከጫንክ እና ከገባህ፦
```bash
cd app/mobile
supabase functions deploy verify-purchase --project-ref klxynisbmxqmyszkdrxj
supabase functions deploy google-play-rtdn --no-verify-jwt --project-ref klxynisbmxqmyszkdrxj
```
(የዌብ ክፍያ — Chapa/USDT — ለዚህ ዙር አያስፈልግም።)

---

## 6. Real-time Developer Notifications (Pub/Sub)

ይህ ሁለት ጥቅም አለው፦ (ሀ) አፑ ተዘግቶ ቢሆንም COIN መጨመር፣ (ለ) Google ገንዘብ ሲመልስ COIN መቀነስ። **ለገንዘብ ደህንነት ይመከራል።**

### 6.1 Pub/Sub topic መፍጠር
1. https://console.cloud.google.com/cloudpubsub ግባ (ፕሮጀክት `beetook-billing`)። **Enable API** ከጠየቀ አንቃ።
2. **Create topic** → Topic ID፦ `play-rtdn` → **Create**። ሙሉ ስሙ ይህን ይመስላል፦ `projects/beetook-billing/topics/play-rtdn` (የፕሮጀክት ID ካንተ ሊለይ ይችላል — በገጹ ላይ ያለውን ኮፒ አድርግ)።
3. Topic ገጽ → ትር **Permissions** → **Add principal** → 
   - **New principals:** `google-play-developer-notifications@system.gserviceaccount.com`
   - **Role:** `Pub/Sub Publisher` → **Save**።

### 6.2 Push subscription መፍጠር
1. Topic ገጽ → **Subscriptions** → **Create subscription**።
2. **Subscription ID:** `play-rtdn-push`
3. **Delivery type:** **Push**
4. **Endpoint URL** (የራስህን ሚስጥር በ`<…>` ቦታ ተካ፣ ቅንፎቹን አስወግድ)፦
```
https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/google-play-rtdn?key=<GOOGLE_PLAY_RTDN_SECRET>
```
ምሳሌ (ሚስጥሩ ከላይ ምሳሌ ከሆነ)፦
```
https://klxynisbmxqmyszkdrxj.supabase.co/functions/v1/google-play-rtdn?key=k8Qz2VmX9pLr4TnW7yHb3JdF6sAc1EgU
```
5. **Enable authentication** — ❌ አትምረጥ።
6. **Create**።

### 6.3 Play Console ላይ ማገናኘት
1. Play Console → አፕህ → **Monetize with Play** → **Monetization setup**።
2. **Real-time developer notifications** ክፍል፦
   - **Topic name:** `projects/beetook-billing/topics/play-rtdn` (የራስህን ሙሉ ስም)
   - **Notification content / Topic type:** **Subscriptions, voided purchases, and all one-time products** ምረጥ
3. **Send test notification** ጠቅ አድርግ → "successfully sent" ማየት አለብህ።
4. **Save changes**።

> ሙከራው ከጠፋ፦ በSupabase → Edge Functions → `google-play-rtdn` → **Logs** ተመልከት። 401 ከሆነ ሚስጥሩ (`?key=`) ከSecret ጋር አይመሳሰልም ወይም Verify JWT አልጠፋም።

---

## 7. አፕን Build ማድረግ እና Play ላይ መጫን

### 7.1 ለProduction/Internal testing — AAB
በኮምፒውተርህ (Node.js እና EAS CLI ከተጫነ፤ `EXPO_TOKEN` ተዘጋጅቶ)፦
```bash
cd app/mobile
eas build -p android --profile production
```
ሲጨርስ የ`.aab` ፋይል አውርድ (EAS ድረ-ገጽ ላይ ሊንክ ይሰጣል)። `versionCode` 45 ነው — **ለእያንዳንዱ አዲስ ሰቀላ ቁጥሩ መጨመር አለበት** (`app.json` → `android.versionCode`)።

> EAS የመፈረሚያ ቁልፍ (keystore) በራሱ ያስተዳድራል። Play App Signing ን ሲጠየቅ ተቀበል።

### 7.2 Internal testing ላይ መስቀል
1. Play Console → አፕህ → **Testing** → **Internal testing** → **Create new release**።
2. **Upload** → የ`.aab` ፋይል ምረጥ። (የመጀመሪያ ሰቀላ በእጅ መሆን አለበት።)
3. **Release name** ራስ-ሰር ይሞላል → **Next** → **Save** → **Go to publishing overview** → **Send for review/Publish**።
4. ትር **Testers** → **Create email list** → ስም `testers` → የራስህን Gmail (እና የሞካሪዎችን) ጨምር → **Save** → ዝርዝሩን ምረጥ።
5. **Copy link** (የመቀላቀያ ሊንክ) ኮፒ አድርግ።

### 7.3 License testers (ገንዘብ እንዳይቆረጥ)
1. Play Console መነሻ ገጽ (ከአፕ ውጭ) → **Settings** → **License testing**።
2. የሞካሪዎችን Gmail ጨምር → **License response:** `RESPOND_NORMALLY` → **Save changes**።
3. በእነዚህ መለያዎች የሚደረግ ግዢ **እውነተኛ ገንዘብ አይቆርጥም** (የሙከራ ግዢ)።

### 7.4 በስልክህ መጫን
1. በስልኩ ላይ ከ7.3 ባለው Gmail ግባ (Play Store ውስጥ ተመሳሳዩ መለያ መሆን አለበት)።
2. በ7.2 የተገኘውን ሊንክ በስልክ አሳሽ ክፈት → **Become a tester** → **Download it on Google Play** → **Install**።
3. ከPlay Store የተጫነው አፕ ብቻ ነው ግዢ የሚሰራው።

---

## 8. መሞከር (Sandbox ሁነታ)

Secret `PAYMENTS_GOOGLE_PLAY_MODE` = `sandbox` መሆኑን አረጋግጥ።

| # | ሙከራ | የሚጠበቅ ውጤት |
|---|---|---|
| 1 | አፕ ክፈት → ግባ → Profile → **Wallet** → **Buy coins** | የ16 ፓኬጆች ዝርዝር በ$ ዋጋ ይታያል፤ "Custom amount" የለም |
| 2 | `$0.99` ፓኬጅ → **Next** → **Pay** | Google Play የክፍያ መስኮት ይከፈታል ("Test card, always approves" ሊታይ ይችላል) |
| 3 | ክፍያ አጠናቅ | "1,584 coins added to your Purchased balance" ይታያል፤ Purchased ሒሳብ +1,584 |
| 4 | ወዲያው ተመሳሳይ ፓኬጅ እንደገና ግዛ | ይሳካል (ግዢው ተጠቅሟል/consumed ተደርጓል)፤ ሒሳብ እንደገና +1,584 |
| 5 | Transactions → **Coin purchases** ማጣሪያ | ሁለቱም ግዢዎች ተመዝግበዋል |
| 6 | ግዢ መስኮቱ ላይ **Cancel** | "ምንም አይጨመርም"፤ ሒሳብ አይቀየርም |
| 7 | የኢንተርኔት ሙከራ፦ ከከፈልክ በኋላ ወዲያው ኢንተርኔት አጥፋ → አፕ ዝጋ → ኢንተርኔት አብራ → Wallet ክፈት | "COIN from an earlier purchase were added" መልዕክት፤ COIN ይመለሳል፣ ሁለት ጊዜ አይጨመርም |
| 8 | **Refund ሙከራ:** Play Console → **Order management** → ግዢውን ምረጥ → **Refund** | ከደቂቃዎች በኋላ COIN ይቀንሳል፤ History ውስጥ "Purchase refunded" |

### የስህተት መልዕክቶች ትርጉም
| መልዕክት | ምክንያት እና መፍትሔ |
|---|---|
| `Product "coins_…" is not set up in Google Play Console yet` | ፓኬጁ አልተፈጠረም/Active አይደለም፣ ወይም ID ተሳስቷል፣ ወይም አፕ ከPlay Store አልተጫነም |
| `google_play payments are not configured yet · Missing: …` | Secret ጠፍቷል (`PAYMENTS_GOOGLE_PLAY_MODE` ወይም `GOOGLE_PLAY_SERVICE_ACCOUNT`) |
| `The payment service is not deployed yet` | `verify-purchase` Function አልተሰማራም |
| `Google Play rejected the purchase (401/403)` | Service Account ፈቃድ ገና አልተሰራጨም ወይም ተሳስቷል (ክፍል 4.2) |
| `Google Play rejected the purchase (404)` | `GOOGLE_PLAY_PACKAGE_NAME` ተሳስቷል ወይም ሌላ አፕ ነው |
| `Test purchases are not accepted in live mode` | Mode `live` ሆኖ በtester መለያ ሞክረሃል — ወደ `sandbox` መልስ |
| `Google Play is not available on this device` | Google Play ከሌለው ስልክ/emulator ወይም ከPlay Store ያልተጫነ አፕ |

---

## 9. ወደ Live (እውነተኛ ገንዘብ) ማውጣት

ሁሉም ሙከራ ከተሳካ ብቻ፦
1. Supabase → Secrets → `PAYMENTS_GOOGLE_PLAY_MODE` ወደ **`live`** ቀይር። (Function እንደገና deploy አያስፈልግም።)
2. Play Console → **Production** → **Create new release** → ተመሳሳዩን AAB (ወይም አዲስ፣ ከፍ ያለ `versionCode`) ስቀል → Review → Publish።
3. የ16ቱ ፓኬጆች **Active** መሆናቸውን እንደገና አረጋግጥ።
4. በእውነተኛ መለያ **ትንሹን $0.99** ግዛ እና ተመላሽ አድርግ — ይህ ሙሉ ሰንሰለቱን በእውነተኛ ሁነታ ያረጋግጣል።

> Live ሁነታ ላይ የtester (test) ግዢዎች **ውድቅ ይደረጋሉ** — ይህ ሆን ተብሎ የተደረገ ጥበቃ ነው።

---

## 10. ኪሳራ እንዳይኖር — ስርዓቱ እንዴት እንደሚጠብቅህ

| አደጋ | ጥበቃ |
|---|---|
| ተጠቃሚ ከፍሎ COIN አልደረሰውም (አፕ ተዘጋ/ኢንተርኔት ጠፋ) | አፑ Wallet ሲከፈት ያልተመዘገቡ ግዢዎችን ይመልሳል (`getAvailablePurchases`)፤ በተጨማሪም Google RTDN ማሳወቂያ COIN ይጨምራል |
| COIN ሁለት ጊዜ ተጨመረ | የግዢ token ልዩ ነው፤ `purchase_settle` አንድ ትዕዛዝ አንድ ጊዜ ብቻ ይጨምራል (ተፈትኗል) |
| ሐሰተኛ ግዢ | COIN የሚጨመረው Google API `purchaseState=0` ካረጋገጠ እና ትዕዛዙ የዚያ ተጠቃሚ ከሆነ ብቻ ነው |
| የሌላ ሰው ትዕዛዝ ላይ ግዢ ማዛመድ | ትዕዛዝ ID በGoogle `obfuscatedProfileId` ይጣራል |
| ተጠቃሚ Google ላይ ገንዘቡን ተመላሽ ጠየቀ | RTDN `voidedPurchase` → COIN አንድ ጊዜ ይቀነሳል (መጀመሪያ Purchased፣ ከዚያ Earnings)፤ ቀድሞ የተጠቀመው ክፍል በ`shortfall` ይመዘገባል |
| ግዢ ሳይጸድቅ ቀረ | Google ያልተረጋገጠ ግዢ ከ3 ቀን በኋላ በራሱ ይመልሳል |
| ዋጋ ወይም COIN በደንበኛ ተለውጦ | ሁሉም ስሌት በሰርቨር ዳታቤዝ ነው፤ ደንበኛ ዋጋ መላክ አይችልም |

### `shortfall` (ጉድለት) ማየት
ተጠቃሚ COIN ተጠቅሞ ከዚያ ተመላሽ ካደረገ፣ ያልተመለሰው መጠን እዚህ ይታያል (SQL Editor)፦
```sql
select id, user_id, product_id, coins, raw->>'shortfall' as shortfall, raw->>'void_reason' as reason, updated_at
from app_9e1318caf6_purchase_orders
where status = 'refunded' and coalesce((raw->>'shortfall')::bigint, 0) > 0
order by updated_at desc;
```

### የሁሉንም ግዢ ሁኔታ ማየት
```sql
select status, count(*) , sum(coins) as total_coins
from app_9e1318caf6_purchase_orders
where provider = 'google_play'
group by status;
```

---

## 11. የቁጥር ማስያ (COIN ስሌት)

`COIN = የUSD ዋጋ × 1,600`

ምሳሌ፦ $4.99 × 1,600 = **7,984 COIN** · $99.99 × 1,600 = **159,984 COIN**

ተመኑን መለወጥ ከፈለግህ (SQL Editor)፤ **ለወደፊት ግዢዎች ብቻ** ይሠራል፦
```sql
update app_9e1318caf6_wallet_config
set value = jsonb_set(value, '{coins_per_usd}', '1600')   -- ቁጥሩን እዚህ ቀይር
where key = 'rates';
```
> ⚠️ የGoogle Play ዋጋዎችን ከቀየርክ፣ በPlay Console ውስጥም ተመሳሳይ ዋጋ መቀየር አለብህ።

---

## 12. የፍተሻ ዝርዝር (Checklist)

- [ ] Developer መለያ + Payments profile ተሟልቷል
- [ ] አፕ `com.beetook.app` ተፈጥሯል
- [ ] 16 ፓኬጆች ተፈጥረው **Active** ናቸው (ID በትክክል)
- [ ] Service Account ተፈጥሯል፣ JSON ወርዷል
- [ ] Android Publisher API ነቅቷል
- [ ] Service Account በPlay Console ሦስት ፈቃዶች ተጋብዟል
- [ ] 4 Secrets በSupabase ገብተዋል
- [ ] `verify-purchase` deploy (JWT ON)
- [ ] `google-play-rtdn` deploy (JWT **OFF**)
- [ ] Pub/Sub topic + push subscription + Play Console ተገናኝቷል (Test notification ተሳክቷል)
- [ ] AAB ተሰቅሏል (Internal testing)፣ License testers ተጨምረዋል
- [ ] ከPlay Store በተጫነ አፕ ሙከራ 1–8 ተሳክተዋል
- [ ] `PAYMENTS_GOOGLE_PLAY_MODE=live`
- [ ] Production release ታትሟል፣ $0.99 እውነተኛ ግዢ + ተመላሽ ተፈትኗል

---

## 13. እርዳታ ሲያስፈልግህ

ችግር ካጋጠመህ ለእኔ ይህን ላክ፦
1. የምታየው ትክክለኛ የስህተት መልዕክት (ስክሪንሾት)
2. የምታደርገው ደረጃ ቁጥር
3. Supabase → Edge Functions → `verify-purchase` → **Logs** የመጨረሻ መስመሮች

ሚስጥሮችን (JSON ፋይሉን፣ RTDN key ን) ወደ ውይይት **አትላክ** — መልዕክቱን ብቻ ላክ።
