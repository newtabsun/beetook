# Bee Took — የData፣ የአፈፃፀም እና የባትሪ ምርመራ (Audit)

ቀን፦ 2026-10-13 · ወሰን፦ `app/mobile` (ዌብ + አንድሮይድ) እና native modules · **የአፕ ኮድ አልተቀየረም።**

> ማሳሰቢያ፦ ሁሉም ሀሳቦች በኮድ ማስረጃ ላይ የተመሰረቱ ናቸው (ፋይል:መስመር)። በእውነተኛ ስልክ ላይ ምንም ነገር **አልተለካም**፤ የተጠቀሱት ቁጥሮች (ጥያቄ በደቂቃ፣ MB) ከኮዱ የተሰሉ ናቸው። "ግምት" የተባሉት ደግሞ ያልተረጋገጡ ናቸው።
>
> **ቀድሞውኑ ያሉ (አይደገሙም)፦** Data Saver፣ በደካማ ኔትወርክ ራስ-ሰር low quality (HLS `clientBandwidthHint`)፣ የphoto 1080px/JPEG 72% resize፣ የቪዲዮ compression (~2.5 Mbps + 700 kbps low copy፣ አንድሮይድ)፣ የቀጣይ 2 ቪዲዮዎች preload (offline/slow/Data Saver ላይ ይዘጋል)፣ የMP4 disk caching፣ global NetworkBanner፣ retry/netStatus፣ offline playback፣ Feed FlatList (`windowSize=3`፣ `removeClippedSubviews`)፣ `memo(Card)`። ከእነዚህ ውስጥ የሚሻሻሉት "ያለውን ማሻሻል" ተብለው ተለይተዋል።

## ማጠቃለያ ሰንጠረዥ

| # | ርዕስ | ዘርፍ | ምክር | የስራ መጠን |
|---|------|------|------|-----------|
| 1 | Live room፦ በየ3 ሰከንዱ የሚደረገውን ከባድ polling ወደ realtime መቀየር | data/ባትሪ/አፈፃፀም | ይመከራል | መካከለኛ |
| 2 | Live chat እና ረጅም ዝርዝሮችን ወደ FlatList መቀየር | አፈፃፀም | ይመከራል | መካከለኛ |
| 3 | Presence፦ የlive ሁኔታ ዝማኔን ቀላል ማድረግ (debounce + ጥቂት columns) | data/ባትሪ | ይመከራል | ትንሽ |
| 4 | Inbox እና Market፦ realtime እያለ የሚደገመውን polling ማስወገድ/ማዘግየት | data/ባትሪ | ይመከራል | ትንሽ |
| 5 | አፑ background ሲሆን ሁሉንም polling/timer ማቆም | ባትሪ/data | ይመከራል | ትንሽ–መካከለኛ |
| 6 | የቪዲዮ player ticker (100ms) እና የዌብ rAF re-render መቀነስ | አፈፃፀም/ባትሪ | ይመከራል | መካከለኛ |
| 7 | የprofile ፎቶ (avatar) በትንሽ መጠን መስቀል | data/አፈፃፀም | ይመከራል | ትንሽ |
| 8 | Preload ማስተካከል (ያለውን ማሻሻል)፦ በደካማ ስልክ 1 ብቻ | አፈፃፀም/ሙቀት | መካከለኛ | ትንሽ |
| 9 | የቪዲዮ disk cache መጠን ገደብ ማስቀመጥ | ተጨማሪ (storage) | ይመከራል | ትንሽ |
| 10 | Mobile data እና Wi-Fiን መለየት | data | መካከለኛ | መካከለኛ |
| 11 | Feed ጥያቄ፦ `select('*')` ፈንታ የሚያስፈልጉ columns ብቻ | data | መካከለኛ | መካከለኛ |
| 12 | `expo-image` መጠቀም (ለምስል caching/memory) | አፈፃፀም/data | መካከለኛ | ትልቅ |
| 13 | የLive background ምስሎችን (5.1MB) ከAPK ማውጣት | ተጨማሪ (app መጠን) | መካከለኛ | መካከለኛ |
| 14 | የAndroid camera (GPUPixel) lifecycle crash ማስተካከል | ተጨማሪ (መረጋጋት)/ሙቀት | ይመከራል | ትልቅ |
| 15 | የcrash ሪፖርት አሰባሰብ (ለምሳሌ Sentry) | ተጨማሪ (መረጋጋት) | መካከለኛ | መካከለኛ |
| 16 | Skiaን ማስወገድ | ተጨማሪ (app መጠን) | አይመከርም | ትልቅ |
| 17 | ለሁሉም ተጠቃሚ የቪዲዮ ጥራትን በቋሚነት ዝቅ ማድረግ | data | አይመከርም | ትንሽ |
| 18 | በfeed ውስጥ autoplay ማጥፋት | data/ባትሪ | አይመከርም | ትንሽ |
| 19 | Online presence (አረንጓዴ ነጥብ) ማስወገድ | ባትሪ/data | አይመከርም | ትንሽ |

---

## ዝርዝር

### 1. Live room፦ በየ3 ሰከንዱ የሚደረገውን ከባድ polling ወደ realtime መቀየር — data / ባትሪ / አፈፃፀም
**ማስረጃ፦** `src/features/live/LiveRoom.tsx:136-160` — በየ3 ሰከንዱ `heartbeatViewer` + `load()` ይጠራሉ። `load()` 5 ጥያቄዎችን በአንድ ጊዜ ያቀርባል (room state፣ seats፣ እስከ 200 events (`api.ts:727`)፣ viewers፣ gifts)፣ ከዚያም **የሁሉንም ሰዎች profile** (`fetchMiniProfiles`) እንደገና ያወርዳል።
**ከማሻሻሉ በፊት፦** ✅ ቀላል አሰራር ነው፤ ሁሌም ወቅታዊ ይሆናል። ❌ ለአንድ ተመልካች በደቂቃ ~140 ጥያቄ ይደርሳል (20 ዙር × ~7)፤ chat ባልተቀየረበት ጊዜም እስከ 200 መልእክት ደጋግሞ ይወርዳል። 30 ደቂቃ live ማየት ብዙ MB ሊፈጅ ይችላል (መጠኑ አልተለካም — ግምት)። በየ3 ሰከንዱ ሁሉም ዝርዝር እንደገና ስለሚሳል ስልኩ ይሞቃል፣ ባትሪም ይፈጃል።
**ከማሻሻሉ በኋላ፦** ✅ events/seats/gifts በSupabase realtime ይመጣሉ (`subscribeTables` አሰራር በ`api.ts:596` ቀድሞ አለ)፤ heartbeat ወደ ~15 ሰከንድ ይሄዳል፤ profile የሚወርደው ለአዲስ ሰው ብቻ ነው። Data እና ባትሪ በግልፅ ይቀንሳሉ። ❌/አደጋ፦ realtime ቢቋረጥ መልእክት ሊዘገይ ይችላል፤ ስለዚህ ረጅም (~30 ሰከንድ) fallback poll ያስፈልጋል። የ"ተመልካች ተባረረ" ምላሽ እስከ 15 ሰከንድ ሊዘገይ ይችላል።
**ምክር፦ ይመከራል** — በመተግበሪያው ውስጥ ትልቁ የdata/ባትሪ ፍጆታ ምንጭ ይህ ነው።
**ፋይሎች፦** `LiveRoom.tsx`፣ `src/lib/api.ts`፣ `src/features/live/useSpeaking.ts` (ያለውን channel እንደገና መጠቀም)።

### 2. Live chat እና ረጅም ዝርዝሮችን ወደ FlatList መቀየር — አፈፃፀም
**ማስረጃ፦** `LiveRoom.tsx:561` chat፣ `ProfileScreen.tsx:129/185/214`፣ `UserProfileScreen.tsx:69`፣ `LiveScreen.tsx:173`፣ `GroupsScreen.tsx:197` — `ScrollView` + `.map()` ስለሆኑ ሁሉንም item በአንድ ጊዜ ይስላሉ (chat እስከ 200፣ profile grid እስከ 120 post — `api.ts:335`)።
**ከማሻሻሉ በፊት፦** ✅ ኮዱ ቀላል ነው፤ ጥቂት item ሲኖር ችግር የለውም። ❌ በአሮጌ አንድሮይድ ላይ scroll ሊንቀራፈፍ፣ memory ሊጨምር ይችላል (ተሰምቶ እንጂ አልተለካም — ግምት)። ከ#1 ጋር ተደምሮ chat በየ3 ሰከንዱ ሙሉ በሙሉ ይሳላል።
**ከማሻሻሉ በኋላ፦** ✅ በስክሪን ላይ የሚታዩት ብቻ ይሳላሉ፤ scroll ለስላሳ ይሆናል። ❌/አደጋ፦ chat ራሱ ወደ ታች የሚሸብለልበት (auto-scroll) ባህሪ እና የprofile header layout በጥንቃቄ መፈተሽ አለባቸው።
**ምክር፦ ይመከራል** (በchat እና በprofile grid እንጀምር)።
**ፋይሎች፦** `LiveRoom.tsx`፣ `ProfileScreen.tsx`፣ `UserProfileScreen.tsx`፣ `GroupsScreen.tsx`።

### 3. Presence፦ የlive ሁኔታ ዝማኔን ቀላል ማድረግ — data / ባትሪ
**ማስረጃ፦** `src/lib/presence.ts:42,70-76` — በlive table ላይ **ማንኛውም** ለውጥ ሲኖር (ለምሳሌ host `peak_viewers` ሲያዘምን፣ `LiveRoom.tsx:166`) ለ**እያንዳንዱ** ተጠቃሚ `select('*').limit(500)` ይደረጋል። ከዚህ በተጨማሪ በየ60 ሰከንዱ እንደገና ይጠየቃል።
**ከማሻሻሉ በፊት፦** ✅ የLIVE ቀለበት ወዲያው ይታያል። ❌ ብዙ live ሲኖር እያንዳንዱ ለውጥ የ500 ረድፍ ሙሉ ዳታ ወደ ሁሉም ስልኮች ይልካል።
**ከማሻሻሉ በኋላ፦** ✅ ዝማኔዎች ይሰበሰባሉ (debounce ~3 ሰከንድ)፤ የሚያስፈልጉት columns ብቻ ይመጣሉ (`id,host_id,title,cover_url,is_live`)፤ realtime ስለሚሰራ የ60 ሰከንዱ poll ወደ ~5 ደቂቃ ይሄዳል። ❌ የLIVE ቀለበት እስከ ~3 ሰከንድ ሊዘገይ ይችላል።
**ምክር፦ ይመከራል** — ትንሽ ለውጥ ሲሆን ጥቅሙ ለሁሉም ተጠቃሚ ይደርሳል።
**ፋይሎች፦** `src/lib/presence.ts`።

### 4. Inbox እና Market፦ realtime እያለ የሚደገመውን polling ማስወገድ — data / ባትሪ
**ማስረጃ፦** `InboxScreen.tsx:102-106` — thread በየ15 ሰከንዱ እስከ 200 መልእክት ያወርዳል፤ realtime ደግሞ አዲስ ለውጥ ሲመጣ `load()` ይጠራል። `MarketScreen.tsx:378-379` — በየ60 ሰከንዱ + realtime።
**ከማሻሻሉ በፊት፦** ✅ realtime ቢቋረጥም ዳታው ይታደሳል። ❌ ምንም ለውጥ ሳይኖር ተደጋጋሚ ሙሉ ማውረድ ይደረጋል።
**ከማሻሻሉ በኋላ፦** ✅ በrealtime ብቻ ይዘምናል፤ poll ወደ ~2 ደቂቃ fallback ይሄዳል፤ ኔትወርክ/አፕ ሲመለስ አንድ ጊዜ ይታደሳል። ❌ realtime በፀጥታ ከተቋረጠ መልእክት እስከ fallback ጊዜው ሊዘገይ ይችላል።
**ምክር፦ ይመከራል።**
**ፋይሎች፦** `InboxScreen.tsx`፣ `MarketScreen.tsx`።

### 5. አፑ background ሲሆን ሁሉንም polling/timer ማቆም — ባትሪ / data
**ማስረጃ፦** `AppState` የሚጠቀመው `presence.ts` ብቻ ነው። Inbox (15s)፣ Market (60s)፣ Live (3s)፣ VIP sweep (`Vip.tsx:40`፣ 60s)፣ presence recheck (60s) ስክሪኑ ሲጠፋም ይቀጥላሉ (አንድሮይድ JS-ን እስኪያቆመው ድረስ — ትክክለኛው ጊዜ በስልኩ ይወሰናል፣ ግምት)።
**ከማሻሻሉ በፊት፦** ✅ አፑ ሲመለስ ዳታው ዝግጁ ሊሆን ይችላል። ❌ ስልኩ ኪስ ውስጥ እያለ ኔትወርክና CPU ይነቃሉ።
**ከማሻሻሉ በኋላ፦** ✅ አንድ የጋራ `useAppActive()` hook ይኖራል፤ background ላይ ሁሉም ይቆማሉ፣ ሲመለሱ አንድ ጊዜ ያድሳሉ። ❌ ተጠቃሚው እንደተመለሰ ለአጭር ጊዜ የቆየ ዳታ ሊያይ ይችላል።
**ምክር፦ ይመከራል።**
**ፋይሎች፦** አዲስ `src/lib/appActive.ts`፣ ከ#1/#3/#4 ፋይሎች + `Vip.tsx`።

### 6. የቪዲዮ player ticker እና የዌብ rAF re-render መቀነስ — አፈፃፀም / ባትሪ
**ማስረጃ፦** `PostMedia.tsx:330` (native) — በየ100ms `setNow` + `onProgress` ስለሚጠሩ ቪዲዮው እና overlays በሰከንድ ~10 ጊዜ ይሳላሉ። `PostMedia.tsx:~100-113` (web) — rAF በየ>30ms `setNow` ይጠራል፤ ይህም በሰከንድ ~30 ጊዜ ነው።
**ከማሻሻሉ በፊት፦** ✅ timed FX/ፅሁፍ/speed ramps በትክክል ይመሳሰላሉ። ❌ ምንም edit የሌለው ቪዲዮም ተመሳሳይ ሸክም ይፈጥራል፤ በደካማ ስልክ ላይ ሙቀትና መንቀራፈፍ ያስከትላል።
**ከማሻሻሉ በኋላ፦** ✅ ቪዲዮው timed edit (fx/overlays/segments) ከሌለው ticker ወደ 250ms ይወርዳል፤ የUI state የሚዘምነው progress bar በሚታይ ለውጥ ሲኖር ብቻ ነው። ❌/አደጋ፦ ሁሉም የedit አይነቶች በጥንቃቄ ካልተለዩ effects ሊዘገዩ ይችላሉ፤ ስለዚህ ጠንቃቃ ሙከራ ያስፈልጋል።
**ምክር፦ ይመከራል** (feed በብዛት የሚታይበት ቦታ ስለሆነ ጥቅሙ ትልቅ ነው)።
**ፋይሎች፦** `src/features/editor/PostMedia.tsx`።

### 7. የprofile ፎቶ (avatar) በትንሽ መጠን መስቀል — data / አፈፃፀም
**ማስረጃ፦** `ProfileScreen.tsx:98` avatarን በ`uploadMedia(..,'photo')` ይሰቅላል፤ ይህ እስከ 1080px ነው (`api.ts:204`)። Avatar የሚታየው ግን በ22–112px ነው (`FeedScreen.tsx:179` 48px)። Live cover (`api.ts:379`) እና thumbnail (`api.ts:270`) ተመሳሳይ ናቸው።
**ከማሻሻሉ በፊት፦** ✅ ጥራቱ ከፍተኛ ነው። ❌ በfeed/chat ውስጥ ለእያንዳንዱ ትንሽ avatar ~100–200KB ይወርዳል (ግምት)፤ በዝርዝሮች ውስጥ memory ይጨምራል።
**ከማሻሻሉ በኋላ፦** ✅ Avatar ≤320px (~20KB)፣ thumbnail/cover ≤720px። ❌ ቀድሞ የተሰቀሉ avatars አይለወጡም (አዲሶቹ ብቻ)፤ በትልቁ profile ገፅ ላይ ትንሽ ጥራት ይቀንሳል (ብዙም አይታይም)።
**ምክር፦ ይመከራል** — በጣም ትንሽ ለውጥ ነው፤ የ1080px resize ደንብ ላይ "የአጠቃቀም መጠን" መጨመር ነው (ያለውን ማሻሻል)።
**ፋይሎች፦** `src/lib/api.ts` (`uploadMedia` ላይ max size አማራጭ)፣ `ProfileScreen.tsx`።

### 8. Preload ማስተካከል (ያለውን ማሻሻል) — አፈፃፀም / ሙቀት
**ማስረጃ፦** `FeedScreen.tsx:251` ቀጣዮቹን 2 ቪዲዮዎች ያዘጋጃል፤ `PostMedia.tsx:381` (`NativePreload`) ለእያንዳንዱ የተለየ `useVideoPlayer` ይፈጥራል። ስለዚህ ከሚጫወተው ጋር ተደምሮ በአንድ ጊዜ 3 የቪዲዮ decoder ይሰራሉ።
**ከማሻሻሉ በፊት፦** ✅ swipe ሲደረግ ቪዲዮው ወዲያው ይጀምራል። ❌ በአሮጌ/ዝቅተኛ RAM ስልኮች ላይ 3 decoder memory እና ሙቀት ይጨምራሉ (ግምት — በስልክ አልተሞከረም)።
**ከማሻሻሉ በኋላ፦** ✅ ዝቅተኛ RAM ባለው ስልክ ወይም በmobile data ላይ preload 1 ብቻ ይሆናል፤ በWi-Fi/ጠንካራ ስልክ 2 ይቀራል። ❌ በደካማ ስልክ ሁለተኛው ቪዲዮ ትንሽ ዘግይቶ ሊጀምር ይችላል፤ RAMን ለማወቅ `expo-device` (አዲስ dependency) ያስፈልጋል።
**ምክር፦ መካከለኛ** — ጥቅሙ በስልክ ላይ ሳይለካ እርግጠኛ አይደለም።
**ፋይሎች፦** `FeedScreen.tsx`፣ `package.json`።

### 9. የቪዲዮ disk cache መጠን ገደብ ማስቀመጥ — ተጨማሪ (storage)
**ማስረጃ፦** `PostMedia.tsx:321` `useCaching: true` ይጠቀማል፤ ነገር ግን በኮዱ ውስጥ `setVideoCacheSizeAsync`/`clearVideoCacheAsync` የለም። ስለዚህ የexpo-video ነባሪ ገደብ ይሰራል (በdocumentation መሰረት ~1GB — ግምት፣ አልተረጋገጠም)።
**ከማሻሻሉ በፊት፦** ✅ ብዙ ቪዲዮዎች offline ይቀራሉ። ❌ በትንሽ storage ስልኮች ላይ እስከ ~1GB ሊይዝ ይችላል፤ ተጠቃሚዎች "አፑ ቦታ በላ" ብለው ሊያጠፉት ይችላሉ።
**ከማሻሻሉ በኋላ፦** ✅ ለምሳሌ 300MB ገደብ + በsettings ውስጥ "Cache አጽዳ" አዝራር። ❌ offline የሚታዩ ቪዲዮዎች ቁጥር ይቀንሳል።
**ምክር፦ ይመከራል።**
**ፋይሎች፦** `App.tsx` (startup ላይ)፣ `ProfileMenuSheets.tsx` (አዝራር)፣ `src/lib/offline.ts`።

### 10. Mobile data እና Wi-Fiን መለየት — data
**ማስረጃ፦** `src/lib/network.ts` online/slow ብቻ ያውቃል (probe)፤ cellular/Wi-Fi የሚለይ dependency (`expo-network`/NetInfo) በ`package.json` ውስጥ የለም።
**ከማሻሻሉ በፊት፦** ✅ ቀላል ነው፤ Data Saver በእጅ ይበራል። ❌ በmobile data ላይ ተጠቃሚው Data Saverን ካላበራ ሙሉ ጥራት + 2 preload ይወርዳሉ።
**ከማሻሻሉ በኋላ፦** ✅ "በmobile data ላይ ራስ-ሰር Data Saver" አማራጭ (ነባሪው ሊመረጥ ይችላል)፤ preload Wi-Fi ላይ ብቻ። ❌ አዲስ dependency እና አዲስ APK build ያስፈልጋሉ፤ በmobile data ጥራቱ ስለሚቀንስ አንዳንድ ተጠቃሚዎች ላይወዱት ይችላሉ።
**ምክር፦ መካከለኛ** — ጠቃሚ ነው፣ ግን ነባሪ ባህሪ መሆን አለበት ወይስ አማራጭ የሚለውን እርስዎ ይወስኑ።
**ፋይሎች፦** `network.ts`፣ `FeedScreen.tsx`፣ `ProfileMenuSheets.tsx`፣ `package.json`።

### 11. Feed ጥያቄ፦ የሚያስፈልጉ columns ብቻ — data
**ማስረጃ፦** `api.ts:58` (feed)፣ `api.ts:335/823` (profile) — `select('*')`። `edit` JSON (overlays/fx/thumbs) ትልቅ ሊሆን ይችላል።
**ከማሻሻሉ በፊት፦** ✅ ሁሉም field ይገኛል፤ ስህተት ለመስራት አስቸጋሪ ነው። ❌ ያልተፈለጉ fields (ለምሳሌ ለgrid ሙሉ `edit`) ይወርዳሉ።
**ከማሻሻሉ በኋላ፦** ✅ በተለይ የprofile grid ላይ (thumbnail ብቻ በሚያስፈልግበት) ዳታ ይቀንሳል። ❌ feed ራሱ `edit`ን ስለሚፈልግ ቁጠባው መካከለኛ ነው (አልተለካም)፤ field ቢረሳ ባህሪ ሊሰበር ይችላል።
**ምክር፦ መካከለኛ** — በprofile grid ብቻ ብንጀምር ይሻላል።
**ፋይሎች፦** `src/lib/api.ts`።

### 12. `expo-image` መጠቀም — አፈፃፀም / data
**ማስረጃ፦** ሁሉም ምስሎች የRN `Image` ይጠቀማሉ (`PostMedia.tsx:290/362`፣ `ProfileMenuSheets.tsx:66`፣ avatars)፤ `expo-image` አልተጫነም።
**ከማሻሻሉ በፊት፦** ✅ ያለ ተጨማሪ dependency ይሰራል። ❌ የdisk cache ቁጥጥር ውስን ነው፤ ትልቅ ምስል በትንሽ ቦታ ሲታይ memory ይበላል።
**ከማሻሻሉ በኋላ፦** ✅ የተሻለ memory/disk caching፣ ለስላሳ placeholder/transition። ❌ ብዙ ፋይሎች ይነካሉ፣ አዲስ APK ያስፈልጋል፣ የweb ባህሪም መፈተሽ አለበት። #7 ከተሰራ ጥቅሙ ይቀንሳል።
**ምክር፦ መካከለኛ** — ከ#7 በኋላ ቢታሰብ ይሻላል።
**ፋይሎች፦** በብዙ components (~15 ፋይሎች)፣ `package.json`።

### 13. የLive background ምስሎችን ከAPK ማውጣት — ተጨማሪ (app መጠን)
**ማስረጃ፦** `assets/` 15MB ነው፤ ከዚህ ውስጥ `assets/live-bg` 106 webp (5.1MB)፣ `assets/themes` 2.3MB፣ `assets/live` 1.2MB ናቸው።
**ከማሻሻሉ በፊት፦** ✅ ምስሎቹ offline ይገኛሉ፤ ወዲያውም ይታያሉ። ❌ APK ይተልቃል፤ ይህም download እና update ጊዜ data ይፈጃል።
**ከማሻሻሉ በኋላ፦** ✅ APK በ~5MB ይቀንሳል፤ ምስሎቹ ሲመረጡ ብቻ ይወርዳሉ (cache ይደረጋሉ)። ❌ የመጀመሪያው ምርጫ ኔትወርክ ይፈልጋል፤ ምስሎቹን Supabase Storage ላይ መስቀል ያስፈልጋል።
**ምክር፦ መካከለኛ።**
**ፋይሎች፦** `src/features/live/BgPicker.tsx`፣ የassets ዝርዝር።

### 14. የAndroid camera (GPUPixel) lifecycle crash ማስተካከል — ተጨማሪ (መረጋጋት) / ሙቀት
**ማስረጃ፦** `modules/gpupixel-camera/android/.../GpuPixelCameraView.kt` — crash አሁንም ያልተፈታ ነው (`.atoms/PROGRESS.md`)።
**ከማሻሻሉ በፊት፦** ✅ camera filters ይሰራሉ። ❌ crash ተጠቃሚን ያባርራል፤ GL/camera በትክክል ካልተለቀቀ (ግምት) background ላይም ሙቀትና ባትሪ ሊፈጅ ይችላል።
**ከማሻሻሉ በኋላ፦** ✅ በonPause/onDetach ላይ camera እና GL በትክክል ይለቀቃሉ፤ crash ይቀንሳል። ❌ ያለ እውነተኛ አንድሮይድ ስልክ ሊረጋገጥ አይችልም፤ APK build ያስፈልጋል።
**ምክር፦ ይመከራል** — ለመረጋጋት በጣም መሰረታዊ ነው (ሙከራውን እርስዎ በስልክ ላይ ማድረግ ያስፈልጋል)።
**ፋይሎች፦** `GpuPixelCameraView.kt`፣ `src/features/post/CreateCamera.tsx`።

### 15. የcrash ሪፖርት አሰባሰብ — ተጨማሪ (መረጋጋት)
**ማስረጃ፦** `src/components/CrashGuard.tsx` ስህተትን በስክሪን ላይ ያሳያል፤ ወደ አገልጋይ የሚላክ ሪፖርት የለም።
**ከማሻሻሉ በፊት፦** ✅ ተጨማሪ አገልግሎት ወይም ቁልፍ አያስፈልግም። ❌ በተጠቃሚዎች ስልክ ላይ የሚደርሱ crashes (እንደ #14) አይታወቁም።
**ከማሻሻሉ በኋላ፦** ✅ crashes ከስልኩ ሞዴል ጋር ይመዘገባሉ። ❌ የSentry (ወይም ተመሳሳይ) account/ቁልፍ ያስፈልጋል፤ APK ትንሽ ይተልቃል፤ የግላዊነት ማሳወቂያም ያስፈልጋል።
**ምክር፦ መካከለኛ።**
**ፋይሎች፦** `App.tsx`፣ `CrashGuard.tsx`፣ `package.json`።

### 16. Skiaን ማስወገድ — ተጨማሪ (app መጠን)
**ማስረጃ፦** `@shopify/react-native-skia` በ`Theme105StageSkia.tsx` (105 photo themes) ውስጥ ጥቅም ላይ ይውላል።
**ከማሻሻሉ በፊት፦** ✅ themes በGPU ለስላሳ ይሰራሉ። ❌ native library ስለሆነ APKን ያተልቃል (መጠኑ አልተለካም)።
**ከማሻሻሉ በኋላ፦** ✅ APK ያንሳል። ❌ 105ቱ themes ይሰበራሉ ወይም እንደገና መሰራት አለባቸው፤ አፈፃፀሙም ሊባባስ ይችላል።
**ምክር፦ አይመከርም** — የሚጠፋው ዋና ባህሪ ከሚገኘው ጥቅም ይበልጣል።

### 17. ለሁሉም ተጠቃሚ የቪዲዮ ጥራትን በቋሚነት ዝቅ ማድረግ — data
**ከማሻሻሉ በፊት (አሁን)፦** ✅ HLS ABR + በደካማ ኔትወርክ ራስ-ሰር low + Data Saver አሉ። ❌ በጥሩ ኔትወርክ ብዙ data ይፈጃል።
**ከማሻሻሉ በኋላ፦** ✅ data ይቀንሳል። ❌ በጥሩ ኔትወርክ ላይም ቪዲዮው ደብዛዛ ይሆናል፤ ተጠቃሚዎች አይወዱትም።
**ምክር፦ አይመከርም** — አሁን ያለው አሰራር (ABR + Data Saver) እና #10 ይህን በተሻለ ይፈታሉ።

### 18. በfeed ውስጥ autoplay ማጥፋት — data / ባትሪ
**ከማሻሻሉ በፊት (አሁን)፦** ✅ እንደ TikTok ቪዲዮው ወዲያው ይጀምራል። ❌ እያንዳንዱ ቪዲዮ data ይፈጃል።
**ከማሻሻሉ በኋላ፦** ✅ data/ባትሪ ይቀንሳል። ❌ የአፑ ዋና ልምድ ይበላሻል። Data Saver ላይ "tap to play" ቀድሞውኑ አለ።
**ምክር፦ አይመከርም።**

### 19. Online presence ማስወገድ — ባትሪ / data
**ከማሻሻሉ በፊት (አሁን)፦** ✅ አረንጓዴ ነጥብ እና LIVE ቀለበት ይታያሉ። ❌ heartbeat (45s) + realtime channel ይሰራሉ።
**ከማሻሻሉ በኋላ፦** ✅ ትንሽ ባትሪ ይቆጠባል። ❌ ማህበራዊ ባህሪ ይጠፋል። #3 እና #5 ፍጆታውን ባህሪውን ሳያጠፉ ይቀንሳሉ።
**ምክር፦ አይመከርም።**

---

## የሚመከረው ቅደም ተከተል (ካፀደቁ)
1. ፈጣንና ትንሽ ስራዎች፦ #3፣ #4፣ #5፣ #7፣ #9
2. ትልቅ ጥቅም ያላቸው፦ #1፣ #2፣ #6
3. ውሳኔ የሚፈልጉ፦ #8፣ #10፣ #11፣ #12፣ #13፣ #15
4. አንድሮይድ ስልክ የሚፈልግ፦ #14

ማረጋገጫ (ለእያንዳንዱ)፦ `pnpm exec tsc --noEmit` + `pnpm exec expo export --platform web`። native ለውጦች (#8፣ #10፣ #12፣ #14፣ #15) አዲስ APK እና በስልክ ላይ ሙከራ ያስፈልጋቸዋል።
