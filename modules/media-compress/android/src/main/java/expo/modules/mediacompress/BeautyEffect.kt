package expo.modules.mediacompress

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

/**
 * GPU beauty bake v3 (GLSL ES 2) — same algorithm as the live beauty-camera shader so preview == export:
 * wide skin mask (dark/brown skin aware), 2-ring edge-preserving smoothing, blemish/under-eye lift, glow,
 * clarity on non-skin, vibrance, tone curve. strength = slider 0..1 (perceptual curve applied here).
 */
@UnstableApi
class BeautyEffect(private val strength: Float, private val fx: FloatArray = floatArrayOf(0f, 0f, 0f)) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = BeautyProgram(useHdr, curve(strength), fx)
  companion object {
    fun curve(v: Float) = if (v <= 0f) 0f else Math.pow(v.coerceIn(0f, 1f).toDouble(), 0.6).toFloat()
  }
}

@UnstableApi
private class BeautyProgram(useHdr: Boolean, private val strength: Float, private val fx: FloatArray) : BaseGlShaderProgram(useHdr, 1) {
  private val program: GlProgram = try {
    GlProgram(VERTEX, FRAGMENT).apply {
      setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
      setFloatsUniform("uTransformationMatrix", GlUtil.create4x4IdentityMatrix())
      setFloatsUniform("uTexTransformationMatrix", GlUtil.create4x4IdentityMatrix())
    }
  } catch (e: GlUtil.GlException) { throw VideoFrameProcessingException(e) }
  private var w = 1f
  private var h = 1f

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    w = inputWidth.toFloat(); h = inputHeight.toFloat()
    return Size(inputWidth, inputHeight)
  }

  override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
    try {
      val k = maxOf(1f, minOf(w, h) / 1080f)
      program.use()
      program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
      program.setFloatsUniform("uTexel", floatArrayOf(k / w, k / h))
      program.setFloatUniform("uStrength", strength.coerceIn(0f, 1f))
      program.setFloatsUniform("uFx", fx)
      program.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    } catch (e: GlUtil.GlException) { throw VideoFrameProcessingException(e, presentationTimeUs) }
  }

  override fun release() {
    super.release()
    try { program.delete() } catch (e: GlUtil.GlException) { throw VideoFrameProcessingException(e) }
  }

  companion object {
    const val VERTEX = """
attribute vec4 aFramePosition;
uniform mat4 uTransformationMatrix;
uniform mat4 uTexTransformationMatrix;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = uTransformationMatrix * aFramePosition;
  vec4 t = vec4(aFramePosition.x * 0.5 + 0.5, aFramePosition.y * 0.5 + 0.5, 0.0, 1.0);
  vTexSamplingCoord = (uTexTransformationMatrix * t).xy;
}"""
    const val FRAGMENT = """
precision mediump float;
uniform sampler2D uTexSampler;
uniform vec2 uTexel;
uniform float uStrength;
uniform vec3 uFx;
varying vec2 vTexSamplingCoord;
vec3 tx(vec2 p){ return texture2D(uTexSampler, p).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float skinMask(vec3 c){
  float y = luma(c);
  float cb = dot(c, vec3(-0.168736, -0.331264, 0.5));
  float cr = dot(c, vec3(0.5, -0.418688, -0.081312));
  float lo = 1.0 - smoothstep(0.08, 0.30, y);
  float m = smoothstep(0.0 - 0.012 * lo, 0.03, cr) * (1.0 - smoothstep(0.21, 0.29, cr))
          * smoothstep(-0.27, -0.18, cb) * (1.0 - smoothstep(0.03 + 0.03 * lo, 0.09 + 0.03 * lo, cb));
  float hue = smoothstep(-0.03, 0.03, c.r - c.g) * smoothstep(-0.07, 0.0, c.g - c.b);
  return m * mix(0.5, 1.0, hue) * smoothstep(0.02, 0.07, y) * (1.0 - smoothstep(0.94, 1.0, y));
}
vec3 beauty(vec3 c, vec2 uv, vec2 px, float s, vec3 fx){
  float yc = luma(c);
  vec3 m1 = c; vec3 m2 = c * c; float n = 1.0; vec3 near = vec3(0.0);
  for (int r = 1; r <= 2; r++) {
    float rad = float(r) * (3.0 + 9.0 * s);
    for (int i = 0; i < 8; i++) {
      float a = (float(i) + 0.5 * float(r - 1)) * 0.7853982;
      vec3 q = tx(uv + vec2(cos(a), sin(a)) * px * rad);
      if (r == 1) near += q;
      m1 += q; m2 += q * q; n += 1.0;
    }
  }
  vec3 mean = m1 / n; near *= 0.125;
  vec3 vr = max(m2 / n - mean * mean, 0.0);
  float eps = mix(0.001, 0.03, s);
  vec3 base = mean + (vr / (vr + eps)) * (c - mean);
  float sk = skinMask(mean) * smoothstep(0.0, 0.25, skinMask(c) + 0.1);
  float k = sk * s;
  float kt = sk * clamp(s + fx.x + fx.y, 0.0, 1.0);
  vec3 o = mix(c, base + (c - base) * mix(0.35, 0.15, s), k);
  o += k * max(luma(mean) - yc, 0.0) * 1.1;
  float y = luma(o);
  o += kt * (0.16 + fx.y) * (1.0 - y) * (1.0 - y) * smoothstep(0.02, 0.2, y) * 1.4;
  float w = kt * (0.55 + fx.x);
  o = mix(o, o * vec3(1.09, 1.0, 0.92), w);
  o.r += w * 0.02 * (1.0 - o.r);
  o.g -= w * 0.008;
  float sat = max(o.r, max(o.g, o.b)) - min(o.r, min(o.g, o.b));
  o = mix(vec3(luma(o)), o, 1.0 + kt * 0.25 * (1.0 - smoothstep(0.05, 0.25, sat)));
  o = mix(o, 1.0 - (1.0 - o) * (1.0 - mean * 0.32), kt * 0.35);
  o += (c - near) * (s * 0.9 + fx.z) * (1.0 - sk);
  o = clamp(o, 0.0, 1.0);
  o += 0.04 * s * (1.0 - o) * (1.0 - o);
  o = o * (1.0 + 0.06 * s) / (1.0 + 0.06 * s * o);
  return clamp(o, 0.0, 1.0);
}
void main() {
  vec3 c = tx(vTexSamplingCoord);
  gl_FragColor = vec4(beauty(c, vTexSamplingCoord, uTexel, uStrength, uFx), 1.0);
}"""
  }
}
