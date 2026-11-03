# Bee Took — Feed video algorithm እና Storage/Compression እቅድ (T16)

ዋቢ፦ `docs/beetook-requirements.md` (Supabase metadata፣ Cloudflare Stream VOD፣ "No binaries in Postgres")።
ሁኔታ፦ **እቅድ ብቻ ነው፤ ኮድ አልተጻፈም።** የሚተገበረው ባለቤቱ ካፀደቀ በኋላ ነው።

---

## ክፍል 1 — Feed video algorithm

### 1.1 ምልክቶች (signals)
| ምልክት | ምንጭ | ክብደት (መነሻ) |
|---|---|---|
| የእይታ ማጠናቀቅ መጠን (watch %) እና ድጋሚ ማየት (replay) | የclient `view_events` (በየ3 ሰ. + ሲወጣ) | ከፍተኛ |
| Like / Comment / Share / Save / Follow-from-video | ያሉት tables | መካከለኛ–ከፍተኛ |
| በፍጥነት ማለፍ (<2 ሰ.)፣ "Not interested"፣ report | view_events / ሪፖርት | አሉታዊ |
| Hashtags፣ sound፣ የፈጣሪው ምድብ | posts.edit / caption | ፍላጎትን ማዛመድ |
| አዲስነት (freshness) | created_at | ቀስ እያለ ይቀንሳል (half-life 48 ሰ.) |
| ቋንቋ / ሀገር | profile / device | ማጣሪያ |

### 1.2 ደረጃ አሰጣጥ (ranking) — ምክር፦ በPostgres ቀላል ቀመር፣ ML በኋላ
`score = (0.5·completion + 0.2·likes_rate + 0.15·shares_rate + 0.1·comments_rate + 0.05·saves_rate) × freshness × user_affinity`
- `user_affinity` = ተጠቃሚው ያየቻቸው/የወደዳቸው hashtags/ፈጣሪዎች/sounds (በየቀኑ የሚታደስ vector)።
- ብዝሃነት (diversity)፦ ከአንድ ፈጣሪ በ10 ቪዲዮዎች ውስጥ ≤2፤ ያየው አይደገምም (seen set 7 ቀን)።
- ቅንብር፦ 70% ለግል የተመረጠ + 20% trending + 10% አዲስ ፈጣሪዎች (exploration)።
- ትግበራ፦ `post_scores` materialized view በpg_cron በየ10 ደቂቃ + RPC `feed_for_you(cursor)` 10 ልጥፍ ገጽ።

### 1.3 Cold start
- **አዲስ ተጠቃሚ፦** ሲመዘገብ ምድብ መምረጥ (አማራጭ) → trending + በሀገር/ቋንቋ። ከ20 እይታ በኋላ ለግል መምረጥ ይጀምራል።
- **አዲስ ልጥፍ፦** ለ200–500 ተጠቃሚዎች "test pool" ይታያል፤ completion ≥ አማካይ ከሆነ ወደ ሰፊ ተደራሽነት ይሸጋገራል።

### 1.4 ደረጃዎች (phases)
1. **P1 (1–2 ሳምንት)፦** `view_events` table + client tracking፣ trending score፣ seen-filter፣ diversity። (migration 019)
2. **P2፦** user_affinity፣ test pool cold start፣ "Not interested"።
3. **P3 (ብዙ ተጠቃሚ ሲኖር)፦** embeddings / ML ranking (ውጪ አገልግሎት ወይም Edge Function)።

---

## ክፍል 2 — Storage እና compression

### 2.1 አሁን ያለው ሁኔታ (ማስረጃ)
- ቪዲዮዎች ኦሪጅናል ፋይል ሆነው (ያልተጨመቁ፣ እስከ 4K) ወደ Supabase Storage ይጫናሉ፤ ተጠቃሚው ያከለው ድምፅ ለብቻው ሌላ ፋይል ሆኖ ይጫናል (`lib/api.ts` → `uploadAudio`)።
- Edits (trim/filter/text/sound) ወደ ፋይሉ አልተቃጠሉም (no render)፤ በplayback ላይ ነው የሚተገበሩት። ይህ ነው በfeed ላይ "ሁለት ፋይል" የሚያስመስለው።

### 2.2 ውሳኔዎች እና ምክሮች
| ውሳኔ | አማራጮች | ምክር |
|---|---|---|
| የቪዲዮ ቦታ | Supabase Storage / **Cloudflare Stream** / Cloudflare R2 + ራስ encoding | **Cloudflare Stream** (በrequirements ውስጥ የተወሰነ፤ encoding + ABR/HLS + CDN በአንድ) |
| ፎቶዎች፣ thumbnails፣ ድምፆች | Supabase Storage / R2 | **Supabase Storage** አሁን፤ ሲያድግ R2 (egress ነፃ) |
| Edits ን ማቃጠል (render) እና ቪዲዮ+ድምፅ በአንድ ፋይል (mux) | በስልክ (ffmpeg-kit / Media3 Transformer) / በserver | **በserver**፦ Edge Function → render worker (ffmpeg) → Cloudflare Stream። ffmpeg-kit ተቋርጧል፤ native ጥቅል የAPK መጠንና የcrash አደጋ ይጨምራል |
| በስልክ ቅድመ-መጭመቅ | የለም / ቀላል | **ቀላል**፦ ከመጫን በፊት ≤1080p ፣ ~4 Mbps (ውሂብና ጊዜ ይቆጥባል)። Android ላይ ለዚህ Media3 Transformer ያስፈልጋል (native ለውጥ → ማፅደቅ ያስፈልገዋል) |
| የplayback ጥራት | 1080p only / ABR | **ABR**፦ 360p/540p/720p/1080p (Stream በራሱ ያዘጋጃል)፣ H.264 + AAC |
| Thumbnails | client / server | Stream በራሱ (`thumbnails/thumbnail.jpg?time=`)፤ ፎቶ ልጥፎች ላይ 480px WebP |
| ርዝመት/መጠን ገደብ | — | ≤10 ደቂቃ፣ ≤1 GB ጭነት |

### 2.3 የወጪ ግምት (Cloudflare Stream ዋጋ፦ $5 / 1000 ደቂቃ ማከማቻ በወር + $1 / 1000 ደቂቃ ማስተላለፍ — ከመፅደቁ በፊት በኦፊሴላዊ ገጽ ይረጋገጥ)
| ተጠቃሚ | በወር ቪዲዮ (አማካይ 30 ሰ.) | ማከማቻ (ድምር) | እይታ በወር | ግምታዊ ወጪ/ወር |
|---|---|---|---|---|
| 1K | 3,000 (1,500 ደቂቃ) | 1,500 ደ. | 300K (150K ደ.) | ≈ $8 + $150 ≈ **$160** |
| 10K | 30,000 | 15K ደ. | 3M | ≈ $75 + $1,500 ≈ **$1.6K** |
| 100K | 300,000 | 150K ደ. | 30M | ≈ **$16K** |
ዋናው ወጪ እይታ (delivery) ነው። R2 + ራስ HLS በ100K+ ደረጃ ርካሽ ሊሆን ይችላል፤ ግን ስራው ይበዛል። Render worker (ffmpeg፣ ለምሳሌ Fly.io/Railway) ≈ $20–200/ወር።

### 2.4 የሚተገበርበት ቅደም ተከተል
1. Cloudflare Stream direct-upload (Edge Function `stream-upload-url`) + `posts.stream_uid`።
2. Render worker፦ trim/segments፣ speed፣ ድምፅ mix → አንድ MP4 → Stream። Filters/text በplayback ላይ እንደነበሩ ይቆያሉ።
3. Feed playback ወደ HLS (expo-video HLS ይደግፋል)፤ preload 1 ቀጣይ ቪዲዮ ብቻ።
4. የቆዩ ልጥፎችን ማዛወር (backfill script)።

---

### 2.5 የትግበራ ሁኔታ (2026-10-13)
- [x] በስልክ ቅድመ-መጭመቅ፦ ~2.5 Mbps (≈720p) — Android Media3 native module ካለ ብቻ
- [x] Stream direct-upload፦ 5 MB chunks፣ retry + resume፣ progress %
- [x] Feed playback፦ HLS (Stream ABR)፣ ደካማ ኔትወርክ ላይ በራሱ ዝቅተኛ ጥራት፣ poster መጀመሪያ፣ ቀጣይ 2 covers prefetch
- [x] Data Saver እና offline/slow ባነር
- [ ] Server render worker (ማፅደቅ ያስፈልጋል)
- [ ] Backfill የቆዩ ልጥፎች፤ Supabase Storage MP4 ልጥፎች ዝቅተኛ ጥራት ቅጂ የላቸውም
- [ ] Algorithm P2/P3

## ከባለቤቱ የሚጠበቁ ውሳኔዎች / ማፅደቆች
1. **Cloudflare Stream ን ማፅደቅ** → Cloudflare account + `CLOUDFLARE_ACCOUNT_ID`፣ `CLOUDFLARE_STREAM_API_TOKEN` (Stream:Edit) + የክፍያ ዘዴ።
2. **Server render worker ን ማፅደቅ** (ffmpeg፤ ቦታ፦ Fly.io / Railway / Cloudflare Containers) → account + ≈$20+/ወር።
3. **በስልክ ቅድመ-መጭመቅ (Media3 Transformer — native ጥቅል)፦** ይጨመር ወይስ አይጨመር?
4. **የጥራት ገደቦች፦** ከፍተኛ 1080p? ≤10 ደቂቃ? ≤1 GB?
5. **Algorithm P1 ን ማፅደቅ** → migration 019 (`view_events`, `post_scores`) + pg_cron ን ማብራት።
6. **ወርሃዊ የበጀት ጣሪያ** (ለCloudflare/worker)።
7. **EAS plan** (Free plan ኮታ እስከ 2026-11-01 አልቋል) — ማሻሻል ወይስ መጠበቅ?
