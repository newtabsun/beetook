package expo.modules.gpupixelcamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GpuPixelCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GpuPixelCamera")
    OnCreate {
      appContext.reactContext?.let { CrashLog.install(it); GpuPixelCameraView.prewarm(it) }
      // Beauty for LiveKit camera tracks: track._setVideoEffect("gpupixel-beauty") in JS.
      appContext.reactContext?.applicationContext?.let { c ->
        try { com.oney.WebRTCModule.videoEffects.ProcessorProvider.addProcessor("gpupixel-beauty") { LiveBeautyProcessor(c) } } catch (_: Throwable) { }
      }
    }
    Function("setLiveBeauty") { s: Double, w: Double -> GpuPixelCameraView.liveS = s.toFloat().coerceIn(0f, 1f); GpuPixelCameraView.liveW = w.toFloat().coerceIn(0f, 1f) }
    // Camera must not keep running (or be closed by the OS mid-frame) while the app is in the background.
    OnActivityEntersBackground { GpuPixelCameraView.enterBackground() }
    OnActivityEntersForeground { GpuPixelCameraView.enterForeground() }
    Function("takeCrashReport") { appContext.reactContext?.let { CrashLog.take(it) } }
    // Live-room freeze watchdog (see JsWatchdog): heartbeat, stop, and step marks recorded before risky sync calls.
    Function("jsBeat") { appContext.reactContext?.let { c -> JsWatchdog.beat(c) { appContext.currentActivity } } }
    Function("jsBeatStop") { JsWatchdog.stop() }
    Function("jsMark") { line: String -> JsWatchdog.mark(line) }
    View(GpuPixelCameraView::class) {
      Events("onFirstFrame", "onCameraError")
      Prop("facing") { v: GpuPixelCameraView, f: String -> v.setFacing(f) }
      Prop("torch") { v: GpuPixelCameraView, t: Boolean -> v.setTorch(t) }
      AsyncFunction("setLevels") { v: GpuPixelCameraView, s: Double, w: Double -> v.setLevels(s.toFloat(), w.toFloat()) }
      AsyncFunction("takePicture") { v: GpuPixelCameraView, p: Promise -> v.takePicture(p) }
      AsyncFunction("startRecording") { v: GpuPixelCameraView, mute: Boolean, max: Double, p: Promise -> v.startRecording(mute, max, p) }
      AsyncFunction("stopRecording") { v: GpuPixelCameraView -> v.stopRecording() }
    }
  }
}
