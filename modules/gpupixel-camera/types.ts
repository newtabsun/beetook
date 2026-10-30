export type BeautyLevels = { smoothing: number; whitening: number };

export interface BeautyCameraHandle {
  /** Live update while dragging (no prop change, no re-render, no native reinit). */
  setLevels(l: BeautyLevels): void;
  takePicture(): Promise<string>;
  record(mute: boolean, maxSeconds: number): Promise<string>;
  stop(): void;
}
