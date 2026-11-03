# የቀጥታ ስርጭት አቅራቢ ንፅፅር፦ ZEGOCLOUD እና LiveKit

> ማሳሰቢያ፦ ዋጋዎቹ በይፋዊ የዋጋ ገፆች (zegocloud.com/pricing፣ livekit.io/pricing) ላይ በተደጋጋሚ ይለወጣሉ። ውል ከመፈረምዎ በፊት በእለቱ ያረጋግጡ። ከታች ያሉት አሃዞች የመጨረሻ ይፋዊ መረጃዎችን መሰረት ያደረጉ ግምቶች ናቸው።

## 1. ማጠቃለያ እና ምክር
**ምርጫ፦ LiveKit** — ስራ ሲጀመር LiveKit Cloud፣ ተጠቃሚ ሲበዛ (≈5,000+ DAU) ወደ self-hosted LiveKit (Apache 2.0) መሸጋገር።

| መስፈርት | ZEGOCLOUD | LiveKit | አሸናፊ |
|---|---|---|---|
| ወጭ (Cloud) | ቪዲዮ በ1,000 ደቂቃ ≈$3.99 (HD)፣ ድምፅ ≈$0.99 | በparticipant ደቂቃ ≈$0.0005 + bandwidth | LiveKit |
| ወጭ (self-host) | አይቻልም (ዝግ መድረክ) | የሰርቨር ወጭ ብቻ | LiveKit |
| ነፃ ደረጃ | 10,000 ደቂቃ/ወር | Build plan (ነፃ፣ የተወሰነ ደቂቃ) | ተቀራራቢ |
| መዘግየት | <300ms (በአማካይ ~80–200ms)፣ ሰፊ የራሱ MSDN አውታር | <200–300ms (WebRTC SFU፣ global mesh) | ተቀራራቢ፤ ZEGO በአፍሪካ በትንሹ ይሻላል |
| የአፍሪካ ሰርቨሮች | የአፍሪካ edge nodes አሉት | Cloud ላይ የተገደበ ክልል፤ self-host ላይ በፈለጉት ቦታ (ለምሳሌ Johannesburg/Nairobi/Europe) | ZEGO (Cloud)፣ LiveKit (self-host) |
| 9 ጨዋታዎች overlay | MiniGame SDK + SEI (ዝግጁ) | Data channel/RPC ማመሳሰል + Egress web template | ZEGO በዝግጁነት፤ LiveKit በተለዋዋጭነት |
| ብዙ ሰው ቪዲዮ (9 ወንበር) | ይደግፋል (Live Audio/Video Room UIKit) | ይደግፋል | እኩል |
| React Native/Expo | zego-express-engine-reactnative (Expo dev build ያስፈልጋል) | @livekit/react-native + ይፋዊ Expo plugin | LiveKit |
| Vendor lock-in | ከፍተኛ | ዝቅተኛ (open source) | LiveKit |

አገልግሎታቸው በአብዛኛው ተመሳሳይ ስለሆነ፣ ወሳኙ የወጭ ቆጣቢነት ነው፤ በዚህም LiveKit በግልፅ ያሸንፋል።

## 2. የወጭ ስሌት
### 2.1 ግምቶች
- 9 ሰው ያለበት ክፍል፤ እያንዳንዱ ተጠቃሚ በቀን 60 ደቂቃ፤ 30 ቀን።
- 1,000 DAU → 1.8M ተጠቃሚ-ደቂቃ/ወር፤ 10,000 DAU → 18M።
- ZEGO የሚያስከፍለው በሚቀበሉት (subscribe) ዥረቶች ድምር ጥራት ነው፤ 8 ትናንሽ ቪዲዮዎች በአንድነት ብዙ ጊዜ በ"HD/Full HD" ደረጃ ይቆጠራሉ።

### 2.2 የወር ወጭ (ግምት)
| ሁኔታ | ZEGOCLOUD | LiveKit Cloud | LiveKit self-host |
|---|---|---|---|
| 1,000 DAU ቪዲዮ | ≈ $7,000 (1.8M × $3.99/1k) | ≈ $900 ደቂቃ + ≈$400–1,000 bandwidth ≈ **$1.3k–2k** | ≈ **$300–600** (2–3 ሰርቨር + bandwidth) |
| 1,000 DAU ድምፅ ብቻ | ≈ $1,800 | ≈ $900 | ≈ $150 |
| 10,000 DAU ቪዲዮ | ≈ $70,000 (ቅናሽ ሲደረግ ≈$40k+) | ≈ $13k–20k (Scale/Enterprise ቅናሽ) | ≈ **$3k–6k** |

ማጠቃለያ፦ LiveKit Cloud ከZEGO ≈3–5 እጥፍ ይረክሳል፤ self-host ደግሞ ≈10 እጥፍ ይረክሳል (የDevOps የሰው ኃይል ወጭ ይጨመራል)።

## 3. መዘግየት (Latency)
- ሁለቱም WebRTC/UDP ላይ የተመሰረቱ ሲሆኑ ለንግግር የሚበቃ <300ms ይሰጣሉ።
- ZEGO የራሱ MSDN አውታር ሲኖረው በደካማ ኔትወርክ (እስከ 70% packet loss) መቋቋምን ያስተዋውቃል፤ ይህ ለኢትዮጵያ የሞባይል ኔትወርክ ጠቃሚ ነው።
- LiveKit፦ simulcast፣ dynacast፣ adaptive stream አለው። ለኢትዮጵያ ተጠቃሚዎች የቀረበ ክልል (ለምሳሌ South Africa ወይም Europe/Middle East) ላይ self-host ማድረግ ይቻላል።
- ምክር፦ ከመወሰን በፊት ከአዲስ አበባ (Ethio Telecom እና Safaricom) ሁለቱንም በ1 ሳምንት PoC ይለኩ።

## 4. የ9 ጨዋታዎች overlay ድጋፍ
- **ZEGO**፦ MiniGame SDK ዝግጁ የሆኑ ጨዋታዎች (Ludo፣ UNO ወዘተ) አሉት፤ በSEI ውሂብ ከቪዲዮ ፍሬም ጋር ማመሳሰል ይቻላል። ጉዳቱ፦ ተጨማሪ ክፍያ እና ጥብቅ ጥገኝነት።
- **LiveKit**፦ ጨዋታዎቹ በclient ላይ (React Native view) እንደ overlay ይሳላሉ፤ ሁኔታቸው በData Channel/RPC ወይም በራሳችን backend ይመሳሰላል (ዝቅተኛ መዘግየት)። ለቀረጻ/restream ደግሞ Egress "web template" ጨዋታውንና ቪዲዮውን በአንድ ላይ composite ያደርጋል።
- 9ኙ ጨዋታዎች የራሳችን ስለሆኑ በLiveKit data channel ማመሳሰል ተግባራዊ ነው።

## 5. React Native/Expo እና ዘላቂነት
- LiveKit ይፋዊ Expo config plugin አለው (`@livekit/react-native-expo-plugin`)፤ ZEGO ደግሞ native module ስለሆነ dev build ያስፈልገዋል።
- LiveKit open source (Apache 2.0) ስለሆነ ወደፊት አቅራቢ ለመቀየር ወይም self-host ለማድረግ ነፃ ያደርገናል።

## 6. የትግበራ ዕቅድ
1. PoC (1–2 ሳምንት)፦ LiveKit Cloud + 9 ወንበር + 1 ጨዋታ በdata channel፤ ከአዲስ አበባ latency መለካት።
2. ስራ መጀመር፦ LiveKit Cloud (Ship/Scale plan)።
3. ≈5,000 DAU ሲደርስ፦ ለአፍሪካ ቅርብ ክልል ላይ self-host።
4. PoC ላይ ከአፍሪካ የሚለካው latency ከ400ms በላይ ከሆነ ብቻ ZEGOን እንደገና ማጤን።

## 7. ምንጮች
- https://www.zegocloud.com/pricing
- https://docs.zegocloud.com (MiniGame SDK፣ SEI፣ React Native SDK)
- https://livekit.io/pricing
- https://docs.livekit.io (Self-hosting፣ Egress፣ Data messages፣ React Native/Expo)
- https://github.com/livekit/livekit (Apache 2.0)
