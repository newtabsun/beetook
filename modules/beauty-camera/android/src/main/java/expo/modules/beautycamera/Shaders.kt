package expo.modules.beautycamera

import android.opengl.GLES20

/** GLSL for the CameraX effect (T30). Texcoords are transformed only by the matrix CameraX gives us. */
object Shaders {
  const val BEAUTY_V3 = """
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
  for (int r = 1; r <= RINGS; r++) {
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
}"""

    /** Slider 0..1 → perceptual strength (low values still visible). */
    fun curve(v: Float) = if (v <= 0f) 0f else Math.pow(v.coerceIn(0f, 1f).toDouble(), 0.6).toFloat()

  fun beautyGlsl(rings: Int) = BEAUTY_V3.replace("RINGS", rings.toString())

  const val VS = """
attribute vec2 aPos; attribute vec2 aTex; uniform mat4 uST; varying vec2 vUv;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); vUv = (uST * vec4(aTex, 0.0, 1.0)).xy; }"""

    /** Beauty (shared with media-compress BeautyEffect) + color grade. */
  fun fs(rings: Int) = """
#extension GL_OES_EGL_image_external : require
precision mediump float;
uniform samplerExternalOES uTex; uniform vec2 uPx; uniform float uBeauty; uniform vec3 uBCS; uniform vec4 uTint; uniform vec3 uFx;
varying vec2 vUv;
vec3 tx(vec2 p){ return texture2D(uTex, p).rgb; }
${beautyGlsl(rings)}
void main(){
  vec3 c = tx(vUv);
  vec3 o = (uBeauty > 0.001 || dot(uFx, vec3(1.0)) > 0.001) ? beauty(c, vUv, uPx, uBeauty, uFx) : c;
  o += uBCS.x;
  o = (o - 0.5) * uBCS.y + 0.5;
  o = mix(vec3(luma(o)), o, uBCS.z);
  o *= uTint.rgb;
  o.r += uTint.a * 0.06; o.b -= uTint.a * 0.06;
  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}"""

    private fun shader(type: Int, src: String): Int {
      val s = GLES20.glCreateShader(type); GLES20.glShaderSource(s, src); GLES20.glCompileShader(s)
      val ok = IntArray(1); GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
      if (ok[0] == 0) throw IllegalStateException(GLES20.glGetShaderInfoLog(s))
      return s
    }

  fun link(vs: String, fs: String): Int {
      val p = GLES20.glCreateProgram()
      GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs)); GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs))
      GLES20.glLinkProgram(p)
      val ok = IntArray(1); GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
      if (ok[0] == 0) throw IllegalStateException(GLES20.glGetProgramInfoLog(p))
      return p
    }
}
