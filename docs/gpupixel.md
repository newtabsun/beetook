# GPUPixel የውበት ካሜራ (T33)

## ምንጭ እና ፈቃድ (License)
- ምንጭ፦ https://github.com/pixpark/gpupixel — License፦ **Apache-2.0** (ቅጂው በ`modules/gpupixel-camera/LICENSE-gpupixel` ውስጥ ይገኛል)።
- በMaven ላይ የለም (`com.pixpark` በMaven Central ላይ አልተገኘም)።
- የተጠቀምነው፦ release **v1.3.1** → `gpupixel_android.zip` → `aar/gpupixel-release.aar` (5.0 MB)።
  - ውስጡ የያዘው፦ arm64-v8a እና armeabi-v7a `libgpupixel.so`፣ `libmars-face-kit.so`፣ የፊት ሞዴሎች በassets ውስጥ። minSdk 21 ነው።
- አዲሱ tag `v1.2.x.8` የቆየ API ነው (GPUPixelSourceCamera/vnn)፤ ስለዚህ አልተመረጠም።

## አወቃቀር (Expo)
- `modules/gpupixel-camera/android/libs/gpupixel-release.aar`
- `gpupixel-classes.jar`፦ ከAAR የወጣ የJava API ብቻ፤ በmodule build.gradle ውስጥ `compileOnly` ሆኖ ይገባል።
- `plugin/withGpuPixel.js`፦ prebuild ላይ AAR ፋይሉን ወደ `android/app/libs` ይቀዳል። `android/app/build.gradle` ውስጥ ደግሞ `implementation files('libs/gpupixel-release.aar')` ይጨምራል።
  - prebuild ላይ ተረጋግጧል፦ ሁለቱም ገብተዋል፣ versionCode 32 ነው።
- የድሮው `beauty-camera` አሁንም excluded ነው፤ Skia የለም።

## Pipeline
የፍሬም ፍሰቱ የGPUPixel demo ን ይከተላል፦

1. Camera2 YUV (≤1280x720) ይገባል።
2. `GPUPixel.YUV_420_888toRGBA` ወደ RGBA ይቀይራል።
3. `calculateRotation` + `rotateRgbaImage` ምስሉን ያዞራሉ።
4. `FaceDetector` (mars-face-kit) landmarks ይሰጣል።
5. `SourceRawData` → `BeautyFaceFilter` (skin_smoothing, whiteness) → `FaceReshapeFilter` (thin_face, big_eye + face_landmark) → `SinkRawData`።
6. ውጤቱ በሶስት ቦታ ይሄዳል፦
   - **Preview፦** TextureView canvas ላይ፣ center-crop (ያለ መለጠጥ)፤ የፊት ካሜራ mirror ይደረጋል።
   - **ፎቶ፦** JPEG።
   - **ቪዲዮ፦** `Recorder.kt` — የተሰራው frame (Surface canvas) → H.264፣ ማይክ → AAC፣ ሁለቱም በአንድ nanoTime ሰዓት → MediaMuxer MP4።

v1.3.1 `GPUPixelSinkSurface` የለውም (EAS build aa641b23 በዚህ ምክንያት ወድቋል)። ስለዚህ preview በcanvas ይሳላል።

## Sliders (0..1)
| Slider | ነባሪ (default) |
|--------|----------------|
| Smoothing | 0.6 |
| Whitening | 0.3 |
| Thin face | 0.3 |
| Big eyes | 0.2 |

Thin face እና Big eyes ፊት ሲገኝ ብቻ ይሰራሉ።

## Fallback
GPUPixel ካልተገናኘ (not linked)፣ ስህተት ከመጣ፣ ወይም የመጀመሪያው frame በ3s ውስጥ ካልመጣ በራሱ ወደ expo-camera ይቀየራል። Web ላይ ሁልጊዜ expo-camera ነው።

## ተወግደዋል
- ሁሉም filters/looks፣ FilterLayer፣ BeautyLayer፣ የeditor Filters መሳሪያ፣ የMedia3 color/beauty bake።
- የቆዩ ልጥፎች `edit.filter` ካላቸው ችላ ይባላል።

## ገደቦች / ያልተረጋገጡ
- **Glasses/stickers፦** v1.3.1 Android API ውስጥ የለም (ያሉት Lipstick/Blusher/FaceMakeup ብቻ)፤ ስለዚህ አልገቡም።
- ማዞር፣ mirror፣ FPS፣ A/V sync እና የፊት መለየት በስልክ ላይ አልተፈተሹም።
- RGBA በCPU ስለሚተላለፍ ደካማ ስልኮች ላይ FPS ሊቀንስ ይችላል።
- x86 emulator አይደገፍም (ARM ብቻ)።

## T34/T35 ማሻሻያ (vC33)
- **Beauty ካሜራ ብቻ፦** expo-camera fallback፣ የ3s watchdog switch እና "not available" መልዕክት ተወግደዋል። ስህተት ሲከሰት በፀጥታ እንደገና ይሞክራል (×3)፤ ከዚያም "Retry" ቁልፍ ይታያል።

### Crash root cause (vC32)
- በኮድ ማስረጃ የተገኘ ነው፤ ስልክ ወይም emulator ስላልነበረ crash-ውን በተግባር ደግሞ ማሳየት (reproduce) አልተቻለም።
- GPUPixel በ3 thread ይጠራ ነበር፦
  - camera thread፦ ProcessData እና GetRgbaBuffer
  - UI thread፦ SetProperty እና Destroy
  - io thread፦ FaceDetector መፍጠር እና ማጥፋት
- Destroy ይደረግ የነበረው frame በሂደት ላይ እያለ ነበር። ይህ native use-after-free (SIGSEGV) ያስከትላል።
- ለእያንዳንዱ frame አዲስ Bitmap ይፈጠር ነበር።

### ጥገና
- ሁሉም የGPUPixel/FaceDetector ጥሪዎች በአንድ `gpupixel-work` thread ላይ ብቻ ይሄዳሉ።
- **Backpressure፦** በአንድ ጊዜ አንድ frame ብቻ ይሰራል፤ ሌሎቹ ይጣላሉ።
- ImageReader፦ maxImages 3 ነው፤ Image ሁልጊዜ ይዘጋል።
- Preview Bitmap ደጋግሞ ጥቅም ላይ ይውላል (reuse)።
- lockCanvas እና unlockCanvasAndPost በtry/finally ይጣመራሉ።
- Release ወደ worker thread ይላካል (post)፤ ስለዚህ በሂደት ላይ ካሉ frames በኋላ ይፈጸማል።
- open/close guards እና የCAMERA/RECORD_AUDIO ፈቃድ ፍተሻዎች ተጨምረዋል።

### Presets
- "Adjust" (sliders ያሉት) + Natural, Soft, Clear, Glow, Fair, Porcelain, Slim, Doll, Glam።
- Thumbnails በ`assets/beauty` ውስጥ ናቸው።
- ምርጫው `bee.beauty.v1` በሚል ቁልፍ በAsyncStorage ውስጥ ይቀመጣል።
- Sliders ሲጎተቱ እሴቶቹ በ`setLevels` በ~30fps በቀጥታ ወደ native ይላካሉ፤ ሲለቀቁ (release) ይቀመጣሉ (commit)።

### Web
- getUserMedia + WebGL shader (smoothing/whitening) ይጠቀማል።
- Thin face እና Big eyes በweb ላይ አይሰሩም።

## T37 (vC34): GPUPixel ተወግዷል → zero-copy GPU beauty
- **የቀድሞው lag ምክንያት (በኮድ የታየ)፦** ፍሰቱ ImageReader YUV → CPU RGBA → CPU rotate → face detect → GPU upload → GPU readback → Bitmap → Canvas ነበር። ይህም ለእያንዳንዱ frame 3–4 ሙሉ የCPU copy (~3.6MB) እና face detection ማለት ነው፤ ስለዚህ latency እና lag ይፈጠር ነበር።
- **አዲሱ ንድፍ፦** Camera2 (TEMPLATE_PREVIEW, AE fps ≤30, NR/EDGE FAST) → SurfaceTexture (OES) → ባለ አንድ pass shader (skin-aware luma-guided smoothing 16/8 taps + whitening log curve) → TextureView EGL surface። ሁሉም በአንድ GL thread ላይ ይሄዳል፤ የCPU copy የለም።
- **Recording፦** ተመሳሳዩ GL pass ወደ MediaCodec input surface ይሳላል (pts = camera timestamp → MONOTONIC)። AAC ደግሞ ከAudioRecord.getTimestamp (MONOTONIC) ይወስዳል፤ ስለዚህ የማይክ መዘግየት ይካካሳል።
- **None ሲመረጥ፦** shader passthrough ብቻ ነው (1 tap)።
- **Adaptive፦** frame time EMA ከ30ms በላይ ከሆነ ወደ 8 taps ይቀንሳል፤ ፈጣን ሲሆን ወደ 16 ይመለሳል። ይህ ሎጂክ በሁሉም ስልኮች አንድ አይነት ነው።
- **Orientation፦** Camera2 rotation rule + SurfaceTexture matrix ይጠቀማል። የፊት ካሜራ mirror ይደረጋል። `scripts/beauty-orientation-sim.mjs` 8/8 PASS (model ብቻ)።
- **Presets፦** None (default)፣ Adjust (Smoothing/Whitening)፣ Natural፣ Soft፣ Clear፣ Glow፣ Fair፣ Porcelain፣ Silk፣ Bright፣ Studio። ምርጫው `bee.beauty.v2` በሚል ቁልፍ ይቀመጣል፤ የቆዩ thin/eyes እሴቶች ችላ ይባላሉ።
- **Web፦** WebGL + requestVideoFrameCallback፣ 720p።
