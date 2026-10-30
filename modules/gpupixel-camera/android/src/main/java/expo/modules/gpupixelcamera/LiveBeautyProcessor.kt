package expo.modules.gpupixelcamera

import android.content.Context
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import livekit.org.webrtc.JavaI420Buffer
import livekit.org.webrtc.SurfaceTextureHelper
import livekit.org.webrtc.VideoFrame

/**
 * Applies the GPUPixel beauty filter to the LiveKit camera track (registered as "gpupixel-beauty").
 * Level 0/0 returns null, which makes WebRTC forward the untouched frame (zero extra cost for "None").
 * Any failure or a slow frame (>40 ms on the shared GPU worker) also falls back to the original frame, so video never stalls.
 */
class LiveBeautyProcessor(private val ctx: Context) : VideoFrameProcessor {
  override fun process(frame: VideoFrame, helper: SurfaceTextureHelper?): VideoFrame? {
    if (GpuPixelCameraView.liveS <= 0f && GpuPixelCameraView.liveW <= 0f) return null
    val i420 = try { frame.buffer.toI420() } catch (_: Throwable) { null } ?: return null
    try {
      // Per-pixel CPU conversion must fit the 40 ms budget on mid-range phones, otherwise every frame falls back to the raw
      // camera ("beauty does nothing"). Wide frames are processed at half size (stride 2): ~4x fewer pixels, still 480p+.
      val sx = if (i420.width >= 800) 2 else 1
      val w = (i420.width / sx) and 1.inv(); val h = (i420.height / sx) and 1.inv()
      val rgba = ByteArray(w * h * 4)
      val y = i420.dataY; val u = i420.dataU; val v = i420.dataV
      for (j in 0 until h) for (i in 0 until w) {
        val sj = j * sx; val si = i * sx
        val yy = (y.get(sj * i420.strideY + si).toInt() and 0xFF) - 16
        val uu = (u.get((sj shr 1) * i420.strideU + (si shr 1)).toInt() and 0xFF) - 128
        val vv = (v.get((sj shr 1) * i420.strideV + (si shr 1)).toInt() and 0xFF) - 128
        val c = 298 * yy
        val o = (j * w + i) * 4
        rgba[o] = clamp((c + 409 * vv + 128) shr 8).toByte()
        rgba[o + 1] = clamp((c - 100 * uu - 208 * vv + 128) shr 8).toByte()
        rgba[o + 2] = clamp((c + 516 * uu + 128) shr 8).toByte()
        rgba[o + 3] = -1
      }
      val out = GpuPixelCameraView.beautyRgba(ctx, rgba, w, h) ?: return null
      val buf = JavaI420Buffer.allocate(w, h)
      val oy = buf.dataY; val ou = buf.dataU; val ov = buf.dataV
      for (j in 0 until h) for (i in 0 until w) {
        val o = (j * w + i) * 4
        val r = out[o].toInt() and 0xFF; val g = out[o + 1].toInt() and 0xFF; val b = out[o + 2].toInt() and 0xFF
        oy.put(j * buf.strideY + i, clamp(((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte())
        if ((j and 1) == 0 && (i and 1) == 0) {
          ou.put((j shr 1) * buf.strideU + (i shr 1), clamp(((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte())
          ov.put((j shr 1) * buf.strideV + (i shr 1), clamp(((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte())
        }
      }
      return VideoFrame(buf, frame.rotation, frame.timestampNs)
    } catch (_: Throwable) {
      return null
    } finally {
      i420.release()
    }
  }

  private fun clamp(x: Int) = if (x < 0) 0 else if (x > 255) 255 else x
}
