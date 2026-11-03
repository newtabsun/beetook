# Bee Took camera pipeline (T30, versionCode 29)

## Official sources (CameraX 1.6.0)
- CameraX effects / CameraEffect & SurfaceProcessor: https://developer.android.com/media/camera/camerax/effects (API: https://developer.android.com/reference/androidx/camera/core/CameraEffect, https://developer.android.com/reference/androidx/camera/core/SurfaceProcessor, https://developer.android.com/reference/androidx/camera/core/SurfaceOutput)
- Transform output: https://developer.android.com/media/camera/camerax/transform-output
- PreviewView: https://developer.android.com/reference/androidx/camera/view/PreviewView
- UseCaseGroup / ViewPort: https://developer.android.com/reference/androidx/camera/core/UseCaseGroup
- Source inspected: androidx camera-core / camera-video / camera-view 1.6.0 sources (Preview, ImageCapture, VideoCapture, OutputOptions, VideoRecordEvent, PreviewView).

## Root cause of old defects
The old pipeline (CameraX → SurfaceTexture → custom GLSurfaceView shader) computed rotation, crop, mirror and aspect by hand. Rotation was applied on top of the SurfaceTexture matrix and the aspect was computed for the wrong orientation, which matches the screenshot: `rot=270 buf=1920x1080 view=1080x2352`, a face rotated 90°, stretched, and zoomed.

## New design
- `UseCaseGroup` = `Preview` (→ `PreviewView`, `FILL_CENTER`, `COMPATIBLE`) + `ImageCapture` + `VideoCapture(Recorder)` + `ViewPort` from `PreviewView` + one `CameraEffect` (`BeautyCameraEffect`, targets PREVIEW|VIDEO_CAPTURE|IMAGE_CAPTURE).
- `BeautyProcessor` (SurfaceProcessor): one input SurfaceTexture; for each `SurfaceOutput`, `SurfaceTexture.getTransformMatrix()` → `SurfaceOutput.updateTransformMatrix(updated, original)` (the official sample pattern), then the BEAUTY_V3 shader. CameraX owns rotation, crop and mirroring for every output, so the beauty effect is applied once and never doubled.
- Resolution: `RATIO_16_9_FALLBACK_AUTO_STRATEGY`. Target rotation comes from the display. Zoom ratio is 1.0. Video uses FHD with an HD fallback, front-only mirroring, and audio from Recorder (CameraX handles A/V sync). Photos store front-camera mirroring in EXIF/metadata through `isReversedHorizontal`.
- Fallback: an error/effect error → `onCameraError`, and no `onFirstFrame` within 2.5 s → expo-camera (JS watchdog). The Beauty cam toggle remains. Diagnostics are hidden by default; long-press the Beauty cam button to show them.

## Validation results
- TypeScript, Android export, clean web export, and prebuild (versionCode 29): OK.
- Kotlin compile: only via EAS build f0ff61f3 (no local Android SDK).

## Unverified
Real-device orientation and aspect, front mirroring, photo EXIF, video A/V sync, effect support on low-end devices, and the GL output of the beauty effect.
