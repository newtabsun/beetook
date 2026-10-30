package expo.modules.gpupixelcamera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.view.TextureView
import androidx.core.content.ContextCompat
import com.pixpark.gpupixel.GPUPixel
import com.pixpark.gpupixel.GPUPixelFilter
import com.pixpark.gpupixel.GPUPixelSinkRawData
import com.pixpark.gpupixel.GPUPixelSourceRawData
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Camera2 YUV (720p) → worker thread: YUV→RGBA, rotate upright (Camera2 rule), GPUPixel BeautyFace
 * (smoothing + whitening only, no face detection) → RGBA → reused Bitmap → TextureView / JPEG / MP4.
 * Every GPUPixel object is created, used and destroyed on the single "gpupixel-work" thread.
 */
@SuppressLint("ViewConstructor", "MissingPermission")
class GpuPixelCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  private val onFirstFrame by EventDispatcher()
  private val onCameraError by EventDispatcher()

  private val texture = TextureView(context).also { addView(it, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)); it.surfaceTextureListener = this }

  private var facing = "front"
  private var torch = false
  @Volatile private var smoothing = 0f
  @Volatile private var whitening = 0f
  @Volatile private var alive = false
  @Volatile private var surfaceOk = false
  /** Bumped on every open/close; camera callbacks from an older generation are ignored and closed. */
  private var gen = 0
  private val id = ++ids
  private val busy = AtomicBoolean(false)
  private val drawLock = Any()

  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var reader: ImageReader? = null
  private var request: CaptureRequest.Builder? = null
  private var sensor = 0
  private var front = true

  private var bitmap: Bitmap? = null
  private var firstSent = false
  private var photo: Promise? = null
  private var recorder: Recorder? = null
  private var recordPromise: Promise? = null
  private var recordFile: File? = null
  private var recordStop: Runnable? = null
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val m = Matrix()

  fun setFacing(f: String) { if (f != facing) { facing = f; if (alive) cam.post { if (alive) { closeCamera(); openCamera() } } } }
  fun setTorch(t: Boolean) { torch = t; cam.post { applyRequest() } }
  fun setLevels(s: Float, w: Float) { smoothing = s.coerceIn(0f, 1f); whitening = w.coerceIn(0f, 1f) }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) { surfaceOk = true; start() }
  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
  /** Returning false: the SurfaceTexture is released on the worker AFTER any in-flight lockCanvas/draw finishes. */
  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    // Wait for any in-flight lockCanvas/draw on the worker to finish before the surface goes away.
    synchronized(drawLock) { surfaceOk = false }
    stop()
    work.post { try { st.release() } catch (_: Throwable) { } }
    return false
  }
  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}

  override fun onDetachedFromWindow() { synchronized(drawLock) { surfaceOk = false }; stop(); super.onDetachedFromWindow() }

  /** App went to the background: release the camera device (no frames, no GPU work, no heat). */
  private fun pauseForBackground() { CrashLog.stage(context, "background view=$id"); stop() }

  /** Back in the foreground: reopen only if this view is still on screen with a live surface. */
  private fun resumeFromBackground() { if (surfaceOk && isAttachedToWindow) start() }

  private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

  private fun start() {
    if (alive) return
    if (!granted(Manifest.permission.CAMERA)) { fail("Camera permission is required."); return }
    alive = true
    val prev = owner
    owner = this
    CrashLog.stage(context, "start (pipeline ${if (source != null) "warm" else "cold"})")
    // Camera open and GPUPixel init run in parallel; frames are dropped until the pipeline exists.
    work.post { ensurePipeline(context) }
    // Single owner: the previous view's device is closed first; openCamera then waits for its onClosed.
    cam.post { if (prev != null && prev !== this) prev.closeCamera(); if (alive && owner === this) openCamera() }
  }

  /** The GPUPixel pipeline is shared and never destroyed, so no Destroy can race an in-flight frame. */
  private fun stop() {
    if (!alive) return
    alive = false
    if (owner === this) owner = null
    CrashLog.stage(context, "stop view=$id")
    cam.post { if (pendingOpen === this) pendingOpen = null; closeCamera() }
    work.post {
      finishRecording()
      photo?.reject("E_CAMERA", "Camera closed", null); photo = null
      bitmap?.recycle(); bitmap = null; firstSent = false
      if (owner == null) CrashLog.clearStage(context)
    }
  }

  private fun fail(msg: String) { post { onCameraError(mapOf("message" to msg)) } }

  private fun openCamera() {
    if (!alive) return
    if (owner !== this) return
    if (closing > 0) { pendingOpen = this; return } // previous device still closing → open in onClosed
    val g = ++gen
    CrashLog.stage(context, "open camera ($facing) view=$id gen=$g")
    try {
      val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val want = if (facing == "back") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
      val camId = mgr.cameraIdList.firstOrNull { mgr.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == want } ?: mgr.cameraIdList.first()
      val ch = mgr.getCameraCharacteristics(camId)
      sensor = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
      front = ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
      val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)!!.getOutputSizes(ImageFormat.YUV_420_888)
      val size = sizes.filter { it.width * 9 == it.height * 16 && it.width <= 1280 }.maxByOrNull { it.width }
        ?: sizes.minByOrNull { Math.abs(it.width * it.height - 1280 * 720) }!!
      val r = ImageReader.newInstance(size.width, size.height, ImageFormat.YUV_420_888, 2)
      r.setOnImageAvailableListener({ if (g == gen && reader === it) onImage(it) }, cam)
      reader = r
      mgr.openCamera(camId, object : CameraDevice.StateCallback() {
        override fun onOpened(d: CameraDevice) {
          if (!alive || g != gen) { closeDevice(d); return }
          device = d
          try {
            @Suppress("DEPRECATION")
            d.createCaptureSession(listOf(r.surface), object : CameraCaptureSession.StateCallback() {
              override fun onConfigured(s: CameraCaptureSession) {
                if (!alive || g != gen) { try { s.close() } catch (_: Throwable) {}; return }
                session = s
                try {
                  request = d.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                    addTarget(r.surface)
                    set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                    set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, android.util.Range(30, 30))
                    set(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_FAST)
                    set(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_FAST)
                  }
                  applyRequest()
                  CrashLog.stage(context, "session ok view=$id gen=$g")
                } catch (t: Throwable) { if (g == gen) fail("Camera request: ${t.message}") }
              }
              override fun onConfigureFailed(s: CameraCaptureSession) { if (g == gen) fail("Camera session failed") }
            }, cam)
          } catch (t: Throwable) { if (g == gen) fail("Camera session: ${t.message}") }
        }
        override fun onClosed(d: CameraDevice) { onDeviceClosed() }
        override fun onDisconnected(d: CameraDevice) { if (device === d) { closeCamera() } else closeDevice(d); if (g == gen && alive) fail("Camera disconnected") }
        override fun onError(d: CameraDevice, e: Int) { if (device === d) { closeCamera() } else closeDevice(d); if (g == gen && alive) fail("Camera error $e") }
      }, cam)
    } catch (t: Throwable) { fail("Camera open failed: ${t.message}") }
  }

  private fun applyRequest() {
    val s = session ?: return; val b = request ?: return
    try {
      b.set(CaptureRequest.FLASH_MODE, if (torch && !front) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF)
      s.setRepeatingRequest(b.build(), null, cam)
    } catch (_: Throwable) {}
  }

  /** Camera thread only. Invalidates callbacks first, stops frames, then closes session → device → reader. */
  private fun closeCamera() {
    gen++
    try { reader?.setOnImageAvailableListener(null, null) } catch (_: Throwable) {}
    try { session?.close() } catch (_: Throwable) {}
    device?.let { closeDevice(it) }
    try { reader?.close() } catch (_: Throwable) {}
    session = null; device = null; reader = null; request = null
  }

  private fun closeDevice(d: CameraDevice) {
    closing++
    try { d.close() } catch (_: Throwable) { onDeviceClosed() }
    cam.postDelayed({ if (closing > 0) onDeviceClosed() }, 1500) // safety if onClosed never arrives
  }

  /** Latest frame only: if the worker is still busy, this frame is dropped (no queue). */
  private fun onImage(r: ImageReader) {
    if (reader !== r) return
    val img = try { r.acquireLatestImage() } catch (_: Throwable) { null } ?: return
    if (!alive || owner !== this || source == null || !busy.compareAndSet(false, true)) { img.close(); return }
    val t0 = System.nanoTime()
    val w = img.width; val h = img.height
    val rgba = try { GPUPixel.YUV_420_888toRGBA(img) } catch (_: Throwable) { null } finally { img.close() }
    if (rgba == null) { busy.set(false); return }
    val rot = rotation(sensor, displayRotation(), front)
    val mirror = front
    val tConv = System.nanoTime()
    work.post { try { process(rgba, w, h, rot, mirror, t0, tConv) } catch (t: Throwable) { fail("Frame failed: ${t.message}") } finally { busy.set(false) } }
  }

  /** Chain is fixed (source → beauty → raw, as in vC33). None = both properties 0. Worker thread only. */
  private fun syncFilter() {
    val f = beauty ?: return
    if (smoothing == appliedS && whitening == appliedW) return
    f.SetProperty("skin_smoothing", smoothCurve(smoothing))
    f.SetProperty("whiteness", whitening)
    appliedS = smoothing; appliedW = whitening
  }

  private fun process(rgba: ByteArray, w: Int, h: Int, rot: Int, mirror: Boolean, t0: Long, tConv: Long) {
    if (!alive || owner !== this) return
    val tStart = System.nanoTime()
    val src = source ?: return; val sink = raw ?: return
    syncFilter()
    val data = if (rot == 0) rgba else GPUPixel.rotateRgbaImage(rgba, w, h, rot)
    val ow = if (rot == 90 || rot == 270) h else w
    val oh = if (rot == 90 || rot == 270) w else h
    src.ProcessData(data, ow, oh, ow * 4, GPUPixelSourceRawData.FRAME_TYPE_RGBA)
    val buf = sink.GetRgbaBuffer() ?: return
    if (buf.isEmpty()) return
    val bw = sink.GetWidth().takeIf { it > 0 } ?: ow
    val bh = buf.size / (bw * 4)
    if (bh <= 0) return
    val bmp = bitmap?.takeIf { it.width == bw && it.height == bh } ?: run {
      bitmap?.recycle(); Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888).also { bitmap = it }
    }
    bmp.copyPixelsFromBuffer(ByteBuffer.wrap(buf, 0, bw * bh * 4))
    drawPreview(bmp, mirror)
    recorder?.frame(buf, bw, bh)
    photo?.let { p -> photo = null; savePhoto(bmp, mirror, p) }
    stats.add(tConv - t0, tStart - tConv, System.nanoTime() - tStart)
    if (!firstSent) { firstSent = true; CrashLog.stage(context, "first frame ${bw}x${bh} rot=$rot view=$id"); post { onFirstFrame(mapOf("width" to bw, "height" to bh)) } }
  }

  private fun drawPreview(bmp: Bitmap, mirror: Boolean) = synchronized(drawLock) { drawPreviewLocked(bmp, mirror) }

  private fun drawPreviewLocked(bmp: Bitmap, mirror: Boolean) {
    if (!surfaceOk || !alive) return
    val c = try { texture.lockCanvas() } catch (_: Throwable) { null } ?: return
    try {
      c.drawColor(android.graphics.Color.BLACK)
      val vw = c.width.toFloat(); val vh = c.height.toFloat()
      val sc = maxOf(vw / bmp.width, vh / bmp.height)
      m.reset()
      m.postScale(sc, sc)
      m.postTranslate((vw - bmp.width * sc) / 2f, (vh - bmp.height * sc) / 2f)
      if (mirror) m.postScale(-1f, 1f, vw / 2f, vh / 2f)
      c.drawBitmap(bmp, m, paint)
    } finally { try { texture.unlockCanvasAndPost(c) } catch (_: Throwable) { } }
  }

  private fun savePhoto(bmp: Bitmap, mirror: Boolean, p: Promise) {
    try {
      val out = if (mirror) Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postScale(-1f, 1f) }, false) else bmp
      val f = File(context.cacheDir, "gp_${System.currentTimeMillis()}.jpg")
      FileOutputStream(f).use { out.compress(Bitmap.CompressFormat.JPEG, 92, it) }
      if (out !== bmp) out.recycle()
      p.resolve("file://${f.absolutePath}")
    } catch (t: Throwable) { p.reject("E_PHOTO", t.message, t) }
  }

  fun takePicture(p: Promise) {
    if (!alive) { p.reject("E_CAMERA", "Camera is not ready yet.", null); return }
    work.post { photo?.reject("E_PHOTO", "Superseded", null); photo = p }
  }

  fun startRecording(mute: Boolean, maxSeconds: Double, p: Promise) {
    if (!alive) { p.reject("E_CAMERA", "Camera is not ready yet.", null); return }
    val audio = !mute && granted(Manifest.permission.RECORD_AUDIO)
    work.post {
      if (recorder != null) { p.reject("E_REC", "Already recording", null); return@post }
      val b = bitmap
      if (b == null) { p.reject("E_REC", "Camera is not ready yet.", null); return@post }
      try {
        val f = File(context.cacheDir, "gp_${System.currentTimeMillis()}.mp4")
        recorder = Recorder(f, b.width and 1.inv(), b.height and 1.inv(), front, audio)
        recordFile = f; recordPromise = p
        if (maxSeconds > 0) { val r = Runnable { finishRecording() }; recordStop = r; work.postDelayed(r, (maxSeconds * 1000).toLong()) }
      } catch (t: Throwable) { recorder = null; p.reject("E_REC", t.message, t) }
    }
  }

  fun stopRecording() { work.post { finishRecording() } }

  private fun finishRecording() {
    val rec = recorder ?: return
    recorder = null
    recordStop?.let { work.removeCallbacks(it) }; recordStop = null
    val p = recordPromise; recordPromise = null
    try { val f = rec.finish(); p?.resolve("file://${f.absolutePath}") } catch (t: Throwable) { p?.reject("E_REC", t.message, t) }
  }

  private fun displayRotation(): Int = when (appContext.currentActivity?.windowManager?.defaultDisplay?.rotation) {
    Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0
  }

  companion object {
    // One worker + one camera thread for ALL view instances: GPUPixel calls and camera open/close are serialized.
    private val work = Handler(HandlerThread("gpupixel-work").apply { start() }.looper)
    private val cam = Handler(HandlerThread("gpupixel-cam").apply { start() }.looper)
    @Volatile private var owner: GpuPixelCameraView? = null
    private var ids = 0
    // Camera-thread state: devices still closing, and the view waiting to open after them.
    private var closing = 0
    private var pendingOpen: GpuPixelCameraView? = null

    private fun onDeviceClosed() {
      if (closing > 0) closing--
      if (closing == 0) { val v = pendingOpen; pendingOpen = null; v?.openCamera() }
    }
    // Worker-owned shared pipeline: source → BeautyFace → raw (created once, never destroyed).
    @Volatile private var source: GPUPixelSourceRawData? = null
    private var beauty: GPUPixelFilter? = null
    private var raw: GPUPixelSinkRawData? = null
    private var appliedS = -1f
    private var appliedW = -1f
    private val stats = Stats()

    private fun ensurePipeline(ctx: Context) {
      if (source != null) return
      try {
        val t = System.nanoTime()
        GPUPixel.Init(ctx.applicationContext)
        val b = GPUPixelFilter.Create(GPUPixelFilter.BEAUTY_FACE_FILTER); val o = GPUPixelSinkRawData.Create()
        val s = GPUPixelSourceRawData.Create()
        s.AddSink(b); b.AddSink(o)
        beauty = b; raw = o; appliedS = -1f; appliedW = -1f; source = s
        android.util.Log.i("GpuPixelCam", "pipeline init ${(System.nanoTime() - t) / 1_000_000} ms")
      } catch (t: Throwable) { android.util.Log.e("GpuPixelCam", "init", t) }
    }

    /** Beauty levels for the LiveKit camera track (set from JS); the view's own levels are separate. */
    @Volatile var liveS = 0f
    @Volatile var liveW = 0f

    /** One RGBA frame through the shared pipeline on the GPUPixel worker thread. Null = skip (slow / unavailable). */
    fun beautyRgba(ctx: Context, rgba: ByteArray, w: Int, h: Int): ByteArray? {
      val out = arrayOfNulls<ByteArray>(1)
      val latch = java.util.concurrent.CountDownLatch(1)
      work.post {
        try {
          ensurePipeline(ctx)
          val src = source; val b = beauty; val sink = raw
          if (src != null && b != null && sink != null) {
            if (liveS != appliedS || liveW != appliedW) {
              b.SetProperty("skin_smoothing", smoothCurve(liveS)); b.SetProperty("whiteness", liveW)
              appliedS = liveS; appliedW = liveW
            }
            src.ProcessData(rgba, w, h, w * 4, GPUPixelSourceRawData.FRAME_TYPE_RGBA)
            val buf = sink.GetRgbaBuffer()
            if (buf != null && buf.size >= w * h * 4 && sink.GetWidth() == w) out[0] = buf
          }
        } catch (_: Throwable) { } finally { latch.countDown() }
      }
      return if (latch.await(50, java.util.concurrent.TimeUnit.MILLISECONDS)) out[0] else null
    }

    /** Background pre-warm (app start) so the first camera open skips GPUPixel init. */
    fun prewarm(ctx: Context) { work.post { ensurePipeline(ctx) } }

    // View paused by the activity lifecycle (weak: a destroyed view must not be kept or reopened).
    private var paused: java.lang.ref.WeakReference<GpuPixelCameraView>? = null

    /** Activity entered the background: close the active camera on its own view thread. */
    fun enterBackground() {
      val v = owner ?: return
      paused = java.lang.ref.WeakReference(v)
      v.post { v.pauseForBackground() }
    }

    /** Activity is visible again: reopen the camera that was paused, if its view still exists. */
    fun enterForeground() {
      val v = paused?.get() ?: return
      paused = null
      v.post { v.resumeFromBackground() }
    }

    /** Per-stage timings, logged every 90 frames: adb logcat -s GpuPixelCam. */
    private class Stats {
      private var n = 0; private var a = 0L; private var q = 0L; private var p = 0L
      fun add(conv: Long, queue: Long, proc: Long) {
        n++; a += conv; q += queue; p += proc
        if (n == 90) { android.util.Log.i("GpuPixelCam", "avg ms convert=${a / n / 1_000_000.0} queue=${q / n / 1_000_000.0} beauty+draw=${p / n / 1_000_000.0}"); n = 0; a = 0; q = 0; p = 0 }
      }
    }

    /** Stronger than vC33 (linear): ×1.25 with a slight ease-in, so 0.8 already hits the GPUPixel max of 1.0. */
    fun smoothCurve(s: Float): Float = if (s <= 0f) 0f else minOf(1f, 1.25f * Math.pow(s.toDouble(), 0.9).toFloat())

    /** Official Camera2 rule: clockwise degrees to turn the sensor image upright. Front is mirrored afterwards. */
    fun rotation(sensor: Int, display: Int, front: Boolean): Int =
      if (front) (sensor + display) % 360 else (sensor - display + 360) % 360
  }
}
