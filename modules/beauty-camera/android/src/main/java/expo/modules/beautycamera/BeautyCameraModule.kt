package expo.modules.beautycamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Real-time GPU beauty camera (CameraX → SurfaceTexture → GLES2 shader → screen + MediaCodec). No Skia. */
class BeautyCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BeautyCamera")

    View(BeautyCameraView::class) {
      Events("onReady", "onCameraError", "onFirstFrame", "onDiag")
      Prop("beauty") { view: BeautyCameraView, v: Double -> view.setBeauty(v.toFloat()) }
      Prop("color") { view: BeautyCameraView, m: Map<String, Any?>? -> view.setColor(m) }
      Prop("facing") { view: BeautyCameraView, f: String -> view.setFacing(f) }
      Prop("torch") { view: BeautyCameraView, t: Boolean -> view.setTorch(t) }
      AsyncFunction("takePicture") { view: BeautyCameraView, flash: Boolean, promise: Promise -> view.takePicture(flash, promise) }
      AsyncFunction("startRecording") { view: BeautyCameraView, mute: Boolean, maxSeconds: Double, promise: Promise ->
        view.startRecording(mute, maxSeconds, promise)
      }
      AsyncFunction("stopRecording") { view: BeautyCameraView -> view.stopRecording() }
    }
  }
}
