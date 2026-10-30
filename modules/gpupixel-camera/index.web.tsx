// Web beauty camera: getUserMedia → WebGL beauty shader (edge-preserving smoothing + whitening) → canvas.
// Photo = canvas JPEG, video = canvas.captureStream + mic → MediaRecorder. Same presets as Android.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewProps } from 'react-native';
import type { BeautyLevels, BeautyCameraHandle } from './types';

export type { BeautyLevels, BeautyCameraHandle } from './types';

// LiveKit bridge is Android-only for now (web publishes the raw camera).
export function setLiveBeauty(_l: BeautyLevels) { /* not on web */ }
export function attachLiveBeauty(_track: unknown, _on = true) { /* not on web */ }
export function jsBeat() { /* native only */ }
export function jsBeatStop() { /* native only */ }
export function jsMark(_line: string) { /* native only */ }

export interface BeautyCameraProps extends ViewProps {
  facing: 'front' | 'back'; torch: boolean; levels: BeautyLevels;
}

const VS = 'attribute vec2 p;varying vec2 uv;uniform float m;void main(){uv=vec2(m>0.5?1.0-(p.x*0.5+0.5):p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0.,1.);}';
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D t;uniform vec2 px;uniform float sm;uniform float wh;
void main(){vec4 c=texture2D(t,uv);vec3 sum=c.rgb;float ws=1.0;
for(int i=-3;i<=3;i++)for(int j=-3;j<=3;j++){if(i==0&&j==0)continue;vec3 s=texture2D(t,uv+vec2(float(i),float(j))*px*2.0).rgb;
float w=exp(-dot(s-c.rgb,s-c.rgb)*60.0)*exp(-float(i*i+j*j)/8.0);sum+=s*w;ws+=w;}
vec3 b=sum/ws;float skin=smoothstep(0.02,0.12,c.r-c.b)*smoothstep(0.15,0.35,c.r);
vec3 o=mix(c.rgb,b,sm*mix(0.35,1.0,skin));o=mix(o,1.0-(1.0-o)*(1.0-o*0.6),wh*0.6);gl_FragColor=vec4(o,1.);}`;

/** Still frame from the fallback <video>. */
function snapshot(v: HTMLVideoElement | null): HTMLCanvasElement | null {
  if (!v || !v.videoWidth) return null;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d')?.drawImage(v, 0, 0);
  return c;
}

export const BeautyCamera = forwardRef<BeautyCameraHandle, BeautyCameraProps>(function BeautyCamera(
  { facing, levels, style }, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const lv = useRef(levels); lv.current = levels;
  const rec = useRef<{ r: MediaRecorder; done: Promise<string>; mic: MediaStream | null } | null>(null);
  const fallbackVideo = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState(false);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let stop = false; let raf = 0; let stream: MediaStream | null = null;
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    host.current?.appendChild(cv); canvas.current = cv;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing === 'front' ? 'user' : 'environment', width: 1280, height: 720 } });
        if (stop) return;
        video.srcObject = stream; await video.play();
        const gl = cv.getContext('webgl', { preserveDrawingBuffer: true });
        if (!gl) {
          // No WebGL: show the live video with a CSS soften/brighten approximation (never a black screen).
          video.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;${facing === 'front' ? 'transform:scaleX(-1);' : ''}filter:brightness(${1 + lv.current.whitening * 0.15}) contrast(${1 - lv.current.smoothing * 0.08})`;
          cv.replaceWith(video); canvas.current = null; fallbackVideo.current = video;
          return;
        }
        const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const pr = gl.createProgram()!; gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('shader');
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        const u = (n: string) => gl.getUniformLocation(pr, n);
        const loop = () => {
          if (stop) return;
          if (video.videoWidth && (cv.width !== video.videoWidth || cv.height !== video.videoHeight)) { cv.width = video.videoWidth; cv.height = video.videoHeight; gl.viewport(0, 0, cv.width, cv.height); }
          if (video.readyState < 2) { schedule(); return; }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
          gl.uniform2f(u('px'), 1 / Math.max(1, cv.width), 1 / Math.max(1, cv.height));
          gl.uniform1f(u('sm'), lv.current.smoothing); gl.uniform1f(u('wh'), lv.current.whitening); gl.uniform1f(u('m'), facing === 'front' ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          schedule();
        };
        const v2 = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
        const schedule = () => { if (v2.requestVideoFrameCallback) v2.requestVideoFrameCallback(loop); else raf = requestAnimationFrame(loop); };
        loop();
      } catch { if (!stop) setErr(true); }
    })();
    return () => { stop = true; fallbackVideo.current?.remove(); fallbackVideo.current = null; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); cv.remove(); canvas.current = null; };
  }, [facing, gen]);

  useImperativeHandle(ref, () => ({
    setLevels: (l) => { lv.current = l; },
    takePicture: async () => {
      const c = canvas.current ?? snapshot(fallbackVideo.current);
      if (!c || !c.width) throw new Error('Camera is not ready yet.');
      return c.toDataURL('image/jpeg', 0.95);
    },
    record: async (mute) => {
      const c = canvas.current;
      const fv = fallbackVideo.current;
      if ((!c || !c.width) && !fv) throw new Error('Camera is not ready yet.');
      const src = c && c.width ? c.captureStream(30) : (fv!.srcObject as MediaStream);
      const tracks = [...src.getVideoTracks()];
      let mic: MediaStream | null = null;
      if (!mute) { try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); tracks.push(...mic.getAudioTracks()); } catch { mic = null; } }
      const mimeType = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(new MediaStream(tracks), { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<string>((res, rej) => {
        r.onstop = () => { mic?.getTracks().forEach((t) => t.stop()); const b = new Blob(chunks, { type: r.mimeType || 'video/webm' }); if (b.size) res(URL.createObjectURL(b)); else rej(new Error('No video was captured.')); };
      });
      rec.current = { r, done, mic };
      r.start(250);
      return done;
    },
    stop: () => { if (rec.current?.r.state === 'recording') rec.current.r.stop(); rec.current = null; },
  }), []);

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {createElement('div', { ref: host, style: { position: 'absolute', inset: 0 } })}
      {err && (
        <View style={s.center}>
          <Pressable accessibilityLabel="Retry camera" onPress={() => { setErr(false); setGen((g) => g + 1); }} style={s.btn}><Text style={s.t}>Retry</Text></Pressable>
        </View>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: '#FFA500', borderRadius: 22, paddingHorizontal: 26, paddingVertical: 11 },
  t: { color: '#000', fontWeight: '900' },
});
