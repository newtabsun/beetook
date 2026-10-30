// Web beauty for the LiveKit camera track: WebGL smoothing + whitening, published as the processed track.
// Low latency: exactly one render per camera frame (requestVideoFrameCallback), capped at 640 px wide (phones cannot run the
// shader at 720p+ in real time; that was the lag), stepping down further on slow devices.
// Never black: the processed track is only used once a first frame was really drawn; if none arrives within 1.5 s
// (autoplay blocked, WebGL context lost, ...) the raw camera is used and `unsupported` is set so the UI can tell the user.
import type { Track, TrackProcessor, VideoProcessorOptions } from 'livekit-client';
import { BEAUTY_FS, BEAUTY_VS } from '../../../modules/gpupixel-camera/webShader';
import type { BeautyLevels } from '../../../modules/gpupixel-camera';

const MAX_WIDTHS = [640, 540, 426, 320];
const FIRST_FRAME_MS = 1500;
type VideoEl = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class WebBeautyProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  name = 'bee-beauty';
  processedTrack?: MediaStreamTrack;
  /** True when the browser could not run the effect: the raw camera is passed through. */
  unsupported = false;
  private levels: BeautyLevels = { smoothing: 0, whitening: 0 };
  private video?: VideoEl;
  private canvas?: HTMLCanvasElement;
  private handle = 0;
  private stopped = true;
  private step = 0;
  private winStart = 0;
  private winFrames = 0;
  private winSource = 0;
  private gotFrame?: () => void;

  setLevels(l: BeautyLevels) { this.levels = l; }

  private passThrough(track: MediaStreamTrack) {
    this.stopLoop();
    this.unsupported = true;
    this.processedTrack = track;
  }

  async init(opts: VideoProcessorOptions) {
    this.stopped = false; this.step = 0; this.winStart = 0; this.unsupported = false;
    const video = document.createElement('video') as VideoEl;
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.srcObject = new MediaStream([opts.track]);
    this.video = video;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, desynchronized: true, powerPreference: 'high-performance' });
    if (!gl) { this.passThrough(opts.track); return; }
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, BEAUTY_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, BEAUTY_FS)); gl.linkProgram(pr); gl.useProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.passThrough(opts.track); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const uPx = gl.getUniformLocation(pr, 'px'); const uSm = gl.getUniformLocation(pr, 'sm'); const uWh = gl.getUniformLocation(pr, 'wh');
    gl.uniform1f(gl.getUniformLocation(pr, 'm'), 0); // un-mirrored: viewers see the real orientation

    const schedule = () => {
      this.handle = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };
    const draw = (now: number) => {
      if (this.stopped) return;
      schedule();
      const vw = video.videoWidth;
      if (!vw || video.readyState < 2) return;
      const w = Math.min(vw, MAX_WIDTHS[this.step]) & ~1;
      const h = Math.round((video.videoHeight * w) / vw) & ~1;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform2f(uPx, 1 / w, 1 / h);
      gl.uniform1f(uSm, this.levels.smoothing); gl.uniform1f(uWh, this.levels.whitening);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (this.gotFrame) { this.gotFrame(); this.gotFrame = undefined; }
      this.watch(now);
    };
    this.canvas = canvas;
    const first = new Promise<boolean>((res) => { this.gotFrame = () => res(true); setTimeout(() => res(false), FIRST_FRAME_MS); });
    const out = canvas.captureStream().getVideoTracks()[0]; // a frame is emitted on every draw: no fixed-rate padding
    void video.play().catch(() => undefined);
    schedule();
    if (await first) { this.processedTrack = out; return; }
    out.stop();
    this.passThrough(opts.track);
  }

  /** Slow device: if we render clearly fewer frames than the camera delivers, step the resolution down (never back up). */
  private watch(now: number) {
    const q = this.video?.getVideoPlaybackQuality?.();
    if (!this.winStart) { this.winStart = now; this.winFrames = 0; this.winSource = q?.totalVideoFrames ?? 0; return; }
    this.winFrames += 1;
    const dt = now - this.winStart;
    if (dt < 2000) return;
    const src = (q?.totalVideoFrames ?? 0) - this.winSource;
    const slow = src > 0 ? this.winFrames < src * 0.85 : (this.winFrames * 1000) / dt < 20;
    if (slow && this.step < MAX_WIDTHS.length - 1) this.step += 1;
    this.winStart = now; this.winFrames = 0; this.winSource = q?.totalVideoFrames ?? 0;
  }

  private stopLoop() {
    this.stopped = true;
    if (this.video?.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.handle); else cancelAnimationFrame(this.handle);
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = undefined; this.canvas = undefined; this.gotFrame = undefined;
  }

  async restart(opts: VideoProcessorOptions) { await this.destroy(); await this.init(opts); }

  async destroy() {
    const own = !this.unsupported;
    this.stopLoop();
    if (own) this.processedTrack?.stop(); // pass-through: the camera track belongs to LiveKit, never stop it here
    this.processedTrack = undefined;
  }
}
