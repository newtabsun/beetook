package expo.modules.mediacompress

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.RgbAdjustment
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/** Re-encodes a video to H.264, short side ≤ 1080 px, ~4 Mbps, using Media3 Transformer (hardware encoder). */
class MediaCompressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaCompress")

    // T28: direct MediaStore insert (Pictures/BeeTook or Movies/BeeTook) → returns content:// URI.
    AsyncFunction("saveToGallery") { path: String, mime: String, promise: Promise ->
      try {
        val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
        val src = java.io.File(Uri.parse(path).path ?: path)
        if (!src.exists() || src.length() == 0L) throw IllegalStateException("File missing (${src.length()} bytes)")
        val video = mime.startsWith("video")
        val cr = ctx.contentResolver
        val coll = if (video) android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI else android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val v = android.content.ContentValues().apply {
          put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "BeeTook_${System.currentTimeMillis()}.${if (video) "mp4" else "jpg"}")
          put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
          if (android.os.Build.VERSION.SDK_INT >= 29) {
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, if (video) "Movies/BeeTook" else "Pictures/BeeTook")
            put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
          } else {
            val dir = java.io.File(android.os.Environment.getExternalStoragePublicDirectory(if (video) android.os.Environment.DIRECTORY_MOVIES else android.os.Environment.DIRECTORY_PICTURES), "BeeTook").apply { mkdirs() }
            put(android.provider.MediaStore.MediaColumns.DATA, java.io.File(dir, "BeeTook_${System.currentTimeMillis()}.${if (video) "mp4" else "jpg"}").path)
          }
        }
        val out = cr.insert(coll, v) ?: throw IllegalStateException("MediaStore insert returned null")
        try {
          cr.openOutputStream(out)!!.use { o -> src.inputStream().use { it.copyTo(o) } }
          if (android.os.Build.VERSION.SDK_INT >= 29) cr.update(out, android.content.ContentValues().apply { put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (t: Throwable) { cr.delete(out, null, null); throw t }
        promise.resolve(out.toString())
      } catch (t: Throwable) { promise.reject("E_SAVE", "MediaStore: ${t.message}", t) }
    }

    AsyncFunction("openUri") { uri: String, mime: String, promise: Promise ->
      try {
        val ctx = appContext.currentActivity ?: appContext.reactContext ?: throw IllegalStateException("No context")
        val i = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
          setDataAndType(Uri.parse(uri), mime)
          addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(android.content.Intent.createChooser(i, "Open with").addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(true)
      } catch (t: Throwable) { promise.reject("E_OPEN", t.message ?: "No app can open this file", t) }
    }

    AsyncFunction("compress") { uri: String, bitrate: Int, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("E_NO_CONTEXT", "No Android context", null)
        return@AsyncFunction
      }
      val out = File(ctx.cacheDir, "bee-${System.currentTimeMillis()}.mp4")
      // Transformer must be created and started on a Looper thread.
      Handler(Looper.getMainLooper()).post {
        try {
          val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(uri)))
            .setEffects(Effects(listOf(), listOfNotNull(fit1080(ctx, uri))))
            .build()
          val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .build()
          Transformer.Builder(ctx)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setEncoderFactory(encoders)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, result: ExportResult) {
                promise.resolve("file://${out.absolutePath}")
              }
              override fun onError(composition: Composition, result: ExportResult, e: ExportException) {
                out.delete()
                promise.reject("E_COMPRESS", e.message ?: "Compression failed", e)
              }
            })
            .build()
            .start(item, out.absolutePath)
        } catch (e: Throwable) {
          promise.reject("E_COMPRESS", e.message ?: "Compression failed", e)
        }
      }
    }

    /** Photo/slideshow post → one 1080x1920 H.264/AAC MP4: photos in order, `seconds` each, filter baked,
     *  optional sound on a looping sequence that the photo sequence length trims (single clock → no A/V drift). */
    AsyncFunction("slideshow") { uris: List<String>, spec: Map<String, Any?>, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null || uris.isEmpty()) {
        promise.reject("E_SLIDES", "Nothing to render", null)
        return@AsyncFunction
      }
      val out = File(ctx.cacheDir, "bee-s-${System.currentTimeMillis()}.mp4")
      Handler(Looper.getMainLooper()).post {
        try {
          val ms = (((spec["seconds"] as? Number)?.toDouble() ?: 2.0).coerceIn(0.3, 30.0) * 1000).toLong()
          val soundUrl = spec["soundUrl"] as? String
          val soundVolume = (spec["soundVolume"] as? Number)?.toFloat() ?: 1f
          val videoFx = mutableListOf<Effect>().apply {
            addAll(colorFx(spec["color"]))
            add(Presentation.createForWidthAndHeight(1080, 1920, Presentation.LAYOUT_SCALE_TO_FIT))
          }
          val photos = uris.map { u ->
            EditedMediaItem.Builder(
              MediaItem.Builder().setUri(Uri.parse(u)).setMimeType(MimeTypes.IMAGE_JPEG).setImageDurationMs(ms).build()
            ).setFrameRate(30).setEffects(Effects(listOf(), videoFx)).build()
          }
          val sequences = mutableListOf(EditedMediaItemSequence(photos, false))
          if (!soundUrl.isNullOrEmpty()) {
            val gainFx = if (soundVolume != 1f) listOf<AudioProcessor>(ChannelMixingAudioProcessor().apply {
              putChannelMixingMatrix(ChannelMixingMatrix.create(1, 1).scaleBy(soundVolume))
              putChannelMixingMatrix(ChannelMixingMatrix.create(2, 2).scaleBy(soundVolume))
            }) else listOf()
            val snd = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(soundUrl)))
              .setRemoveVideo(true).setEffects(Effects(gainFx, listOf())).build()
            sequences.add(EditedMediaItemSequence(listOf(snd), true))
          }
          val composition = Composition.Builder(sequences).experimentalSetForceAudioTrack(true).build()
          val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(8_000_000).build())
            .build()
          Transformer.Builder(ctx)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoders)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, result: ExportResult) {
                promise.resolve("file://${out.absolutePath}")
              }
              override fun onError(composition: Composition, result: ExportResult, e: ExportException) {
                out.delete()
                promise.reject("E_SLIDES", e.message ?: "Slideshow render failed", e)
              }
            })
            .build()
            .start(composition, out.absolutePath)
        } catch (e: Throwable) {
          out.delete()
          promise.reject("E_SLIDES", e.message ?: "Slideshow render failed", e)
        }
      }
    }

    /** On-device mux: kept segments + speed + optional added sound → one H.264/AAC MP4 (≤1080p). */
    AsyncFunction("render") { uri: String, spec: Map<String, Any?>, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("E_NO_CONTEXT", "No Android context", null)
        return@AsyncFunction
      }
      val out = File(ctx.cacheDir, "bee-r-${System.currentTimeMillis()}.mp4")
      Handler(Looper.getMainLooper()).post {
        try {
          @Suppress("UNCHECKED_CAST")
          val segs = (spec["segments"] as? List<Map<String, Any?>>).orEmpty()
            .map { ((it["s"] as Number).toDouble() * 1000).toLong() to ((it["e"] as Number).toDouble() * 1000).toLong() }
            .filter { it.second > it.first }
          val speed = (spec["speed"] as? Number)?.toFloat()?.takeIf { it > 0f } ?: 1f
          val volume = (spec["volume"] as? Number)?.toFloat() ?: 1f
          val keepOriginal = spec["keepOriginal"] as? Boolean ?: true
          val soundUrl = spec["soundUrl"] as? String
          val soundVolume = (spec["soundVolume"] as? Number)?.toFloat() ?: 1f
          val bitrate = (spec["bitrate"] as? Number)?.toInt() ?: 4_000_000

          fun gain(v: Float): ChannelMixingAudioProcessor = ChannelMixingAudioProcessor().apply {
            putChannelMixingMatrix(ChannelMixingMatrix.create(1, 1).scaleBy(v))
            putChannelMixingMatrix(ChannelMixingMatrix.create(2, 2).scaleBy(v))
          }
          val ranges = if (segs.isEmpty()) listOf<Pair<Long, Long>?>(null) else segs
          val videoItems = ranges.map { r ->
            val mi = MediaItem.Builder().setUri(Uri.parse(uri))
            if (r != null) mi.setClippingConfiguration(
              MediaItem.ClippingConfiguration.Builder().setStartPositionMs(r.first).setEndPositionMs(r.second).build()
            )
            val audioFx = mutableListOf<AudioProcessor>()
            if (speed != 1f) audioFx.add(SonicAudioProcessor().apply { setSpeed(speed); setPitch(1f) })
            if (volume != 1f) audioFx.add(gain(volume))
            val videoFx = mutableListOf<Effect>().apply { (spec["skin"] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }.let { fxl -> val fx = if (fxl != null && fxl.size == 3) fxl.toFloatArray() else floatArrayOf(0f, 0f, 0f); val bv = (spec["beauty"] as? Number)?.toFloat() ?: 0f; if (bv > 0f || fx.any { it > 0f }) add(BeautyEffect(bv, fx)) }; addAll(colorFx(spec["color"])); fit1080(ctx, uri)?.let { add(it) } }
            if (speed != 1f) videoFx.add(0, SpeedChangeEffect(speed))
            EditedMediaItem.Builder(mi.build())
              .setRemoveAudio(!keepOriginal)
              .setEffects(Effects(audioFx, videoFx))
              .build()
          }
          val sequences = mutableListOf(EditedMediaItemSequence(videoItems, false))
          if (!soundUrl.isNullOrEmpty()) {
            val snd = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(soundUrl)))
              .setRemoveVideo(true)
              .setEffects(Effects(if (soundVolume != 1f) listOf(gain(soundVolume)) else listOf(), listOf()))
              .build()
            sequences.add(EditedMediaItemSequence(listOf(snd), true))
          }
          val composition = Composition.Builder(sequences).build()
          val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .build()
          Transformer.Builder(ctx)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoders)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, result: ExportResult) {
                promise.resolve("file://${out.absolutePath}")
              }
              override fun onError(composition: Composition, result: ExportResult, e: ExportException) {
                out.delete()
                promise.reject("E_RENDER", e.message ?: "Render failed", e)
              }
            })
            .build()
            .start(composition, out.absolutePath)
        } catch (e: Throwable) {
          out.delete()
          promise.reject("E_RENDER", e.message ?: "Render failed", e)
        }
      }
    }
  }
}

/** Downscale so the short side is <=1080 (displayed orientation); null when already small or unknown. */
internal fun fit1080(ctx: Context, uri: String): Presentation? {
  val r = MediaMetadataRetriever()
  return try {
    r.setDataSource(ctx, Uri.parse(uri))
    var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: return null
    var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: return null
    val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
    if (minOf(w, h) <= 1080) null
    else Presentation.createForHeight(if (h <= w) 1080 else ((h * 1080L / w).toInt() and 1.inv()))
  } catch (e: Exception) { null } finally { try { r.release() } catch (_: Exception) {} }
}

/** Filter bake: same numbers the app previews (brightness/contrast -1..1, saturation -100..100, hue deg, RGB scales). */
internal fun colorFx(raw: Any?): List<Effect> {
  @Suppress("UNCHECKED_CAST")
  val c = raw as? Map<String, Any?> ?: return emptyList()
  fun n(k: String, d: Float) = (c[k] as? Number)?.toFloat() ?: d
  val out = mutableListOf<Effect>()
  val b = n("brightness", 0f); val ct = n("contrast", 0f); val s = n("saturation", 0f); val h = n("hue", 0f)
  if (b != 0f) out.add(Brightness(b.coerceIn(-1f, 1f)))
  if (ct != 0f) out.add(Contrast(ct.coerceIn(-1f, 1f)))
  if (s != 0f || h != 0f) out.add(HslAdjustment.Builder().adjustSaturation(s.coerceIn(-100f, 100f)).adjustHue(h).build())
  val r = n("r", 1f); val g = n("g", 1f); val bl = n("b", 1f)
  if (r != 1f || g != 1f || bl != 1f) out.add(RgbAdjustment.Builder().setRedScale(r).setGreenScale(g).setBlueScale(bl).build())
  return out
}
