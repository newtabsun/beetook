package expo.modules.gpupixelcamera

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Encodes GPUPixel output frames (RGBA from SinkRawData) to H.264 via the encoder input Surface and
 * microphone PCM to AAC; both stamped with System.nanoTime() so picture and sound share one clock.
 */
@SuppressLint("MissingPermission")
class Recorder(private val file: File, private val w: Int, private val h: Int, private val mirror: Boolean, private val withAudio: Boolean) {
  private val video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
  private val audio = if (withAudio) MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC) else null
  private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val surface: android.view.Surface
  private val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  private val drawer = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  @Volatile private var running = true
  private var vTrack = -1; private var aTrack = -1; private var started = false
  private var t0 = -1L
  private val pending = ArrayList<Triple<Boolean, ByteArray, MediaCodec.BufferInfo>>()
  private val threads = ArrayList<Thread>()
  private var audioRec: AudioRecord? = null

  init {
    val vf = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    video.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    surface = video.createInputSurface()
    video.start()
    threads += Thread { drain(video, true) }
    audio?.let { a ->
      val af = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
      a.configure(af, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      a.start()
      val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      audioRec = AudioRecord(MediaRecorder.AudioSource.CAMCORDER, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 16384)).also { it.startRecording() }
      threads += Thread { feedAudio(a) }
      threads += Thread { drain(a, false) }
    }
    threads.forEach { it.start() }
  }

  /** Called on the camera thread; drops the frame if the previous one is still being drawn. */
  fun frame(rgba: ByteArray, fw: Int, fh: Int) {
    if (!running || fw < w || fh < h || !busy.compareAndSet(false, true)) return
    try { drawer.execute {
      try {
        if (fw == w) bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(rgba, 0, w * h * 4))
        else copyCropped(rgba, fw)
        val c = surface.lockHardwareCanvas()
        if (mirror) c.setMatrix(Matrix().apply { setScale(-1f, 1f, w / 2f, 0f) })
        c.drawBitmap(bitmap, null, Rect(0, 0, w, h), PAINT)
        surface.unlockCanvasAndPost(c)
      } catch (_: Throwable) { } finally { busy.set(false) }
    } } catch (_: Throwable) { busy.set(false) }
  }

  private fun copyCropped(rgba: ByteArray, fw: Int) {
    val row = ByteArray(w * 4 * h)
    for (y in 0 until h) System.arraycopy(rgba, y * fw * 4, row, y * w * 4, w * 4)
    bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(row))
  }

  private fun feedAudio(a: MediaCodec) {
    val rec = audioRec ?: return
    while (running) {
      val i = try { a.dequeueInputBuffer(10_000) } catch (_: Throwable) { break }
      if (i < 0) continue
      val buf = a.getInputBuffer(i) ?: continue
      buf.clear()
      val n = rec.read(buf, minOf(buf.capacity(), 4096))
      val now = System.nanoTime() / 1000
      if (n > 0) a.queueInputBuffer(i, 0, n, now - n / 2 * 1_000_000L / RATE, 0) else a.queueInputBuffer(i, 0, 0, now, 0)
    }
    try {
      val i = a.dequeueInputBuffer(500_000)
      if (i >= 0) a.queueInputBuffer(i, 0, 0, System.nanoTime() / 1000, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    } catch (_: Throwable) { }
  }

  private fun drain(codec: MediaCodec, isVideo: Boolean) {
    val info = MediaCodec.BufferInfo()
    var deadline = Long.MAX_VALUE
    while (System.currentTimeMillis() < deadline) {
      if (!running && deadline == Long.MAX_VALUE) deadline = System.currentTimeMillis() + 3000
      val i = try { codec.dequeueOutputBuffer(info, 10_000) } catch (_: Throwable) { break }
      if (i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) { addTrack(codec.outputFormat, isVideo); continue }
      if (i < 0) continue
      val buf = codec.getOutputBuffer(i)
      if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
      if (buf != null && info.size > 0) {
        val bytes = ByteArray(info.size); buf.position(info.offset); buf.get(bytes)
        val copy = MediaCodec.BufferInfo().apply { set(0, info.size, info.presentationTimeUs, info.flags) }
        write(isVideo, bytes, copy)
      }
      codec.releaseOutputBuffer(i, false)
      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
    }
  }

  @Synchronized private fun addTrack(f: MediaFormat, isVideo: Boolean) {
    if (isVideo) vTrack = muxer.addTrack(f) else aTrack = muxer.addTrack(f)
    if (vTrack >= 0 && (audio == null || aTrack >= 0)) {
      muxer.start(); started = true
      pending.forEach { (v, b, inf) -> put(v, b, inf) }
      pending.clear()
    }
  }

  @Synchronized private fun write(isVideo: Boolean, b: ByteArray, inf: MediaCodec.BufferInfo) {
    if (started) put(isVideo, b, inf) else pending += Triple(isVideo, b, inf)
  }

  /** Timeline starts at the first video sample; earlier audio is dropped so A/V start together. */
  private fun put(isVideo: Boolean, b: ByteArray, inf: MediaCodec.BufferInfo) {
    if (t0 < 0) { if (!isVideo) return; t0 = inf.presentationTimeUs }
    val pts = inf.presentationTimeUs - t0
    if (pts < 0) return
    inf.presentationTimeUs = pts
    muxer.writeSampleData(if (isVideo) vTrack else aTrack, ByteBuffer.wrap(b), inf)
  }

  /** Stops capture, flushes both encoders and returns the finished MP4. */
  fun finish(): File {
    running = false
    drawer.shutdown()
    // Wait for the last draw so the encoder Surface/bitmap are never released under it.
    val idle = try { drawer.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS) } catch (_: Throwable) { false }
    try { video.signalEndOfInputStream() } catch (_: Throwable) { }
    threads.forEach { it.join(4000) }
    try { audioRec?.stop() } catch (_: Throwable) { }
    audioRec?.release()
    listOfNotNull(video, audio).forEach { c -> try { c.stop() } catch (_: Throwable) { }; c.release() }
    if (idle) { surface.release(); bitmap.recycle() }
    val ok = synchronized(this) { started && t0 >= 0 }
    try { if (started) muxer.stop() } finally { muxer.release() }
    if (!ok) throw IllegalStateException("No video frames were recorded")
    return file
  }

  companion object {
    private const val RATE = 44100
    private val PAINT = Paint(Paint.FILTER_BITMAP_FLAG)
  }
}
