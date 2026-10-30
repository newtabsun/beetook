package expo.modules.beautycamera

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.MirrorMode
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File

/**
 * T30: official CameraX pipeline. Preview → PreviewView (FILL_CENTER, COMPATIBLE), ImageCapture, VideoCapture(Recorder)
 * and one CameraEffect (BeautyProcessor) bound together in a UseCaseGroup. CameraX handles rotation/crop/mirror/aspect.
 */
class BeautyCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onReady by EventDispatcher()
  private val onCameraError by EventDispatcher()
  private val onFirstFrame by EventDispatcher()
  private val onDiag by EventDispatcher()

  private val main = Handler(Looper.getMainLooper())
  private val lowEnd = (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isLowRamDevice == true
  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val processor = BeautyProcessor(lowEnd, { fail(it) }, { main.post { onFirstFrame(mapOf<String, Any>()) } })
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var imageCapture: ImageCapture? = null
  private var videoCapture: VideoCapture<Recorder>? = null
  private var recording: Recording? = null
  private var lensFacing = CameraSelector.LENS_FACING_BACK
  private var torch = false
  private var failed = false
  private var bindPending = false

  init {
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  // Fabric does not lay out native children: size PreviewView ourselves.
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    previewView.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    previewView.layout(0, 0, w, h)
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); bind() }

  override fun onDetachedFromWindow() {
    try { recording?.stop() } catch (_: Throwable) { }
    recording = null
    try { camera?.cameraControl?.enableTorch(false); provider?.unbindAll() } catch (_: Throwable) { }
    camera = null
    super.onDetachedFromWindow()
  }

  private fun fail(msg: String) { main.post { if (!failed) { failed = true; onCameraError(mapOf("message" to msg)) } } }

  private fun bind() {
    if (bindPending) return
    val owner = appContext.currentActivity as? LifecycleOwner ?: return fail("Camera needs an active screen")
    bindPending = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      bindPending = false
      try {
        val p = future.get(); provider = p
        p.unbindAll()
        val rotation = previewView.display?.rotation ?: android.view.Surface.ROTATION_0
        val res = ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY).build()
        val preview = Preview.Builder().setResolutionSelector(res).setTargetRotation(rotation).build()
          .also { it.surfaceProvider = previewView.surfaceProvider }
        val ic = ImageCapture.Builder().setResolutionSelector(res).setTargetRotation(rotation)
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
        val recorder = Recorder.Builder()
          .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.HD))).build()
        val vc = VideoCapture.Builder(recorder).setTargetRotation(rotation).setMirrorMode(MirrorMode.MIRROR_MODE_ON_FRONT_ONLY).build()
        val group = UseCaseGroup.Builder().setViewPort(previewView.viewPort ?: return@addListener fail("Preview has no size yet"))
          .addUseCase(preview).addUseCase(ic).addUseCase(vc)
          .addEffect(BeautyCameraEffect(processor) { fail("Effect error: ${it.message}") }).build()
        val selector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
        val cam = p.bindToLifecycle(owner, selector, group)
        camera = cam; imageCapture = ic; videoCapture = vc
        cam.cameraControl.setZoomRatio(1f)
        if (cam.cameraInfo.hasFlashUnit()) cam.cameraControl.enableTorch(torch)
        main.post { onDiag(mapOf("text" to "CameraX effect · ${if (lensFacing == CameraSelector.LENS_FACING_FRONT) "front" else "back"} · rot=$rotation · ${preview.resolutionInfo?.resolution ?: "-"}")) }
        onReady(mapOf<String, Any>())
      } catch (t: Throwable) {
        fail("Camera start failed: ${t.message}")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  fun setBeauty(v: Float) { processor.beauty = Shaders.curve(if (v > 1f) v / 100f else v) }
  fun setColor(m: Map<String, Any?>?) { processor.setGrade(m) }
  fun setFacing(f: String) {
    val n = if (f == "front") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
    if (n == lensFacing) return
    lensFacing = n
    if (isAttachedToWindow) bind()
  }
  fun setTorch(t: Boolean) {
    torch = t
    try { camera?.let { if (it.cameraInfo.hasFlashUnit()) it.cameraControl.enableTorch(t) } } catch (_: Throwable) { }
  }

  fun takePicture(flash: Boolean, promise: Promise) {
    val ic = imageCapture ?: return promise.reject("E_NOT_READY", "Camera is not ready yet", null)
    ic.flashMode = if (flash) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
    val f = File(context.cacheDir, "beauty-${System.currentTimeMillis()}.jpg")
    val meta = ImageCapture.Metadata().apply { isReversedHorizontal = lensFacing == CameraSelector.LENS_FACING_FRONT }
    val opts = ImageCapture.OutputFileOptions.Builder(f).setMetadata(meta).build()
    ic.takePicture(opts, ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageSavedCallback {
      override fun onImageSaved(r: ImageCapture.OutputFileResults) { promise.resolve(Uri.fromFile(f).toString()) }
      override fun onError(e: ImageCaptureException) { promise.reject("E_PHOTO", e.message ?: "Could not capture photo", e) }
    })
  }

  @SuppressLint("MissingPermission")
  fun startRecording(mute: Boolean, maxSeconds: Double, promise: Promise) {
    if (recording != null) return promise.reject("E_BUSY", "Already recording", null)
    val vc = videoCapture ?: return promise.reject("E_NOT_READY", "Camera is not ready yet", null)
    val f = File(context.cacheDir, "beauty-${System.currentTimeMillis()}.mp4")
    val out = FileOutputOptions.Builder(f).setDurationLimitMillis((maxSeconds * 1000).toLong().coerceAtLeast(1000)).build()
    var pending = vc.output.prepareRecording(context, out)
    val mic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    if (!mute && mic) pending = pending.withAudioEnabled()
    recording = pending.start(ContextCompat.getMainExecutor(context)) { e ->
      if (e is VideoRecordEvent.Finalize) {
        recording = null
        val ok = e.error == VideoRecordEvent.Finalize.ERROR_NONE || e.error == VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED
        if (ok && f.length() > 0) promise.resolve(Uri.fromFile(f).toString())
        else promise.reject("E_RECORD", "Recording failed (code ${e.error}): ${e.cause?.message ?: ""}", e.cause)
      }
    }
  }

  fun stopRecording() { recording?.stop() }
}
