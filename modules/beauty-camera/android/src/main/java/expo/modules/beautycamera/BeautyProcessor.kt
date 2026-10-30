package expo.modules.beautycamera

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import androidx.camera.core.CameraEffect
import androidx.camera.core.SurfaceOutput
import androidx.camera.core.SurfaceProcessor
import androidx.camera.core.SurfaceRequest
import androidx.core.util.Consumer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executor

/**
 * Official CameraX effect path (T30): CameraX owns rotation, crop, mirroring, aspect and zoom.
 * Mirrors androidx.camera.effects.internal.SurfaceProcessorImpl (1.6.0): input SurfaceTexture → OES texture;
 * for each frame `SurfaceOutput.updateTransformMatrix(out, surfaceTexture matrix)` and draw a full-screen quad
 * with texcoords (0..1) transformed by that matrix only. No own rotation math.
 */
class BeautyProcessor(lowEnd: Boolean, private val onError: (String) -> Unit, private val onFrame: () -> Unit) :
  SurfaceProcessor, SurfaceTexture.OnFrameAvailableListener {
  private val thread = HandlerThread("BeautyGL").apply { start() }
  private val handler = Handler(thread.looper)
  val executor: Executor = Executor { r -> if (Thread.currentThread() == thread) r.run() else handler.post(r) }

  @Volatile var beauty = 0f
  @Volatile private var grade = floatArrayOf(0f, 1f, 1f, 1f, 1f, 1f, 0f)
  @Volatile private var skinFx = floatArrayOf(0f, 0f, 0f)
  private val rings = if (lowEnd || Runtime.getRuntime().availableProcessors() < 6) 1 else 2

  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var context: EGLContext = EGL14.EGL_NO_CONTEXT
  private var config: EGLConfig? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var prog = 0
  private var tex = 0
  private var inW = 1920; private var inH = 1080
  private var input: SurfaceTexture? = null
  private val outputs = LinkedHashMap<SurfaceOutput, Pair<Surface, EGLSurface?>>()
  private val stM = FloatArray(16); private val outM = FloatArray(16)
  private var released = false
  private var firstSent = false

  private val pos: FloatBuffer = fb(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
  private val uv: FloatBuffer = fb(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f))

  init { handler.post { try { initGl() } catch (t: Throwable) { onError("GL init failed: ${t.message}") } } }

  fun setGrade(m: Map<String, Any?>?) {
    fun f(k: String, d: Float) = (m?.get(k) as? Number)?.toFloat() ?: d
    grade = floatArrayOf(f("brightness", 0f), f("contrast", 1f), f("saturation", 1f), f("r", 1f), f("g", 1f), f("b", 1f), f("warmth", 0f))
    skinFx = floatArrayOf(f("skinWarm", 0f), f("skinLift", 0f), f("clarity", 0f))
  }

  private fun initGl() {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    val v = IntArray(2)
    check(EGL14.eglInitialize(display, v, 0, v, 1)) { "eglInitialize" }
    val attrs = intArrayOf(
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGLExt.EGL_RECORDABLE_ANDROID, EGL14.EGL_TRUE,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT, EGL14.EGL_NONE)
    val cfgs = arrayOfNulls<EGLConfig>(1); val n = IntArray(1)
    check(EGL14.eglChooseConfig(display, attrs, 0, cfgs, 0, 1, n, 0) && n[0] > 0) { "eglChooseConfig" }
    config = cfgs[0]
    context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext" }
    pbuffer = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    check(EGL14.eglMakeCurrent(display, pbuffer, pbuffer, context)) { "eglMakeCurrent" }
    prog = Shaders.link(Shaders.VS, Shaders.fs(rings))
    val t = IntArray(1); GLES20.glGenTextures(1, t, 0); tex = t[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
  }

  override fun onInputSurface(request: SurfaceRequest) {
    if (released || tex == 0) { request.willNotProvideSurface(); return }
    val st = SurfaceTexture(tex)
    inW = request.resolution.width; inH = request.resolution.height
    st.setDefaultBufferSize(inW, inH)
    val s = Surface(st)
    request.provideSurface(s, executor) { st.setOnFrameAvailableListener(null); st.release(); s.release(); if (input === st) input = null }
    st.setOnFrameAvailableListener(this, handler)
    input = st
  }

  override fun onOutputSurface(output: SurfaceOutput) {
    if (released) { output.close(); return }
    val surface = output.getSurface(executor, Consumer {
      outputs.remove(output)?.second?.let { e -> dropSurface(e) }
      output.close()
    })
    outputs[output] = surface to null
  }

  override fun onFrameAvailable(st: SurfaceTexture) {
    if (released) return
    try {
      st.updateTexImage(); st.getTransformMatrix(stM)
      for ((out, pair) in outputs.entries.toList()) {
        var egl = pair.second
        if (egl == null) {
          egl = EGL14.eglCreateWindowSurface(display, config, pair.first, intArrayOf(EGL14.EGL_NONE), 0)
          if (egl == null || egl == EGL14.EGL_NO_SURFACE) continue
          outputs[out] = pair.first to egl
        }
        out.updateTransformMatrix(outM, stM)
        EGL14.eglMakeCurrent(display, egl, egl, context)
        val w = IntArray(1); val h = IntArray(1)
        EGL14.eglQuerySurface(display, egl, EGL14.EGL_WIDTH, w, 0); EGL14.eglQuerySurface(display, egl, EGL14.EGL_HEIGHT, h, 0)
        draw(w[0], h[0])
        EGLExt.eglPresentationTimeANDROID(display, egl, st.timestamp)
        if (!EGL14.eglSwapBuffers(display, egl)) { dropSurface(egl); outputs[out] = pair.first to null }
      }
      if (!firstSent && outputs.isNotEmpty()) { firstSent = true; onFrame() }
    } catch (t: Throwable) { onError("Render failed: ${t.message}") }
  }

  private fun draw(w: Int, h: Int) {
    GLES20.glViewport(0, 0, w, h)
    GLES20.glUseProgram(prog)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
    GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "uTex"), 0)
    GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(prog, "uST"), 1, false, outM, 0)
    val k = maxOf(1f, minOf(inW, inH) / 1080f)
    GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "uPx"), k / inW, k / inH)
    GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "uBeauty"), beauty)
    val fx = skinFx; GLES20.glUniform3f(GLES20.glGetUniformLocation(prog, "uFx"), fx[0], fx[1], fx[2])
    val g = grade
    GLES20.glUniform3f(GLES20.glGetUniformLocation(prog, "uBCS"), g[0], g[1], g[2])
    GLES20.glUniform4f(GLES20.glGetUniformLocation(prog, "uTint"), g[3], g[4], g[5], g[6])
    val a = GLES20.glGetAttribLocation(prog, "aPos"); val b = GLES20.glGetAttribLocation(prog, "aTex")
    GLES20.glEnableVertexAttribArray(a); GLES20.glVertexAttribPointer(a, 2, GLES20.GL_FLOAT, false, 0, pos)
    GLES20.glEnableVertexAttribArray(b); GLES20.glVertexAttribPointer(b, 2, GLES20.GL_FLOAT, false, 0, uv)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    GLES20.glDisableVertexAttribArray(a); GLES20.glDisableVertexAttribArray(b)
  }

  private fun dropSurface(e: EGLSurface) {
    EGL14.eglMakeCurrent(display, pbuffer, pbuffer, context)
    EGL14.eglDestroySurface(display, e)
  }

  fun release() {
    handler.post {
      if (released) return@post
      released = true
      for ((out, p) in outputs) { p.second?.let { dropSurface(it) }; out.close() }
      outputs.clear()
      if (display != EGL14.EGL_NO_DISPLAY) {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        if (pbuffer != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, pbuffer)
        if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
        EGL14.eglTerminate(display)
      }
      EGL14.eglReleaseThread()
      thread.quitSafely()
    }
  }

  private fun fb(a: FloatArray): FloatBuffer =
    ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }
}

/** CameraEffect for PREVIEW | VIDEO_CAPTURE | IMAGE_CAPTURE (one shared output stream, CameraX does the per-target transform). */
class BeautyCameraEffect(p: BeautyProcessor, onError: (Throwable) -> Unit) :
  CameraEffect(PREVIEW or VIDEO_CAPTURE or IMAGE_CAPTURE, p.executor, p, Consumer<Throwable> { onError(it) })
