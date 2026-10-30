# GPUPixel ካሜራ (T38 / vC35)

## ፍሰት
Camera2 YUV 720p → (cam thread) acquireLatestImage + busy flag (የመጨረሻው ፍሬም ብቻ) → YUV_420_888toRGBA → (gpupixel-work thread) rotateRgbaImage → SourceRawData → BeautyFaceFilter (skin_smoothing = min(1, s×1.15), whiteness) → SinkRawData → የተደጋገመ Bitmap → TextureView canvas (የፊት ካሜራ mirror) / JPEG / MP4 (Recorder: MediaCodec H.264 + AAC፣ አንድ MONOTONIC ሰዓት)።
"None" (0,0) ሲሆን ፍሬሙ filter ሳያልፍ በቀጥታ ወደ sink ይሄዳል። FaceDetector፣ FaceReshape እና Lipstick የሉም።

## ማዞሪያ (Rotation)
- የፊት ካሜራ = (sensor + display) % 360 በሰዓት አቅጣጫ፣ ከዚያም አግድም mirror።
- የኋላ ካሜራ = (sensor − display + 360) % 360።
- ማስረጃ፦ `node scripts/gpupixel-rotation-sim.mjs` በፒክሰል ደረጃ 4/4 PASS ይሰጣል (front/back × sensor 90/270)። በተቃራኒ አቅጣጫ (CCW) ማዞር ግን በአራቱም ሁኔታዎች ይወድቃል።
- vC34 (beauty-gl) ስህተት፦ `Orientation.matrix` በ uv ላይ `rotateM` ተጠቅሞ ምስሉን በተቃራኒ አቅጣጫ (CCW) አዞረው። ይህ ደግሞ በ SurfaceTexture matrix ላይ ተደራርቦ ተጨመረ። ውጤቱ 90° ስህተት ነበር፦ ፊት በቀኝ በኩል፣ ወደ ግራ እያየ።

## ግንባታ
- AAR v1.3.1 (Apache-2.0) በ `plugin/withGpuPixel.js` በኩል ወደ `android/app/libs` ይገባል፤ ሞጁሉ classes.jar ን compileOnly ይጠቀማል።
- v1.3.1 `GPUPixelSinkSurface` እና `GetHeight` የሉትም።

## T39 (vC36) crash ማስተካከያ
- መንስኤ (በኮድ ልዩነት)፦ vC33 chain ን (source→beauty→raw) አንዴ በ init ላይ ያገናኝ ነበር። vC35 ግን `syncFilter` ውስጥ ብቻ ያገናኘው ነበር፤ default None (0,0) ስለሆነ `on == beautyOn == false` → ምንም sink አልተገናኘም → ያልተገናኘ source ላይ ProcessData/GetRgbaBuffer።
- ማስተካከያ፦ chain እንደ vC33 አንዴ ይገናኛል፤ None = properties 0። Recorder ከ vC33 ተመልሷል። Smoothing = min(1, 1.25·s^0.9)።
- CrashLog፦ Java crash → stack trace፤ native crash → የመጨረሻው stage (init / open camera / first frame) በ filesDir። በሚቀጥለው ጅማሮ CrashNotice ከ Copy ቁልፍ ጋር ያሳያል።
