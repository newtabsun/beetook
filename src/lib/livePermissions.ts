// Every permission a live needs is asked BEFORE the live starts (Go Live screen / before taking a seat), never inside the
// running room: an Android permission dialog pauses the activity, which used to stop the camera mid-start (black video).
import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { Camera } from 'expo-camera';
import { showConfirm } from '../components/DialogHost';

let extrasAsked = false;

async function android(video: boolean): Promise<boolean> {
  const P = PermissionsAndroid.PERMISSIONS;
  const api = Number(Platform.Version) || 0;
  const required: Permission[] = [P.RECORD_AUDIO, ...(video ? [P.CAMERA] : [])];
  // Optional: Bluetooth headsets (Android 12+) and the "you are live" notification (Android 13+). Asked once per app run.
  const optional: Permission[] = extrasAsked ? [] : [
    ...(api >= 31 && P.BLUETOOTH_CONNECT ? [P.BLUETOOTH_CONNECT] : []),
    ...(api >= 33 && P.POST_NOTIFICATIONS ? [P.POST_NOTIFICATIONS] : []),
  ];
  const have = await Promise.all(required.map((p) => PermissionsAndroid.check(p)));
  const missing = required.filter((_, i) => !have[i]);
  const ask = [...missing, ...optional];
  extrasAsked = true;
  if (!ask.length) return true;
  const res = await PermissionsAndroid.requestMultiple(ask);
  return missing.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

async function web(video: boolean): Promise<boolean> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) return false;
  const s = await md.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
  s.getTracks().forEach((t) => t.stop()); // only the grant is needed here; LiveKit opens its own tracks later
  return true;
}

async function ios(video: boolean): Promise<boolean> {
  const cam = video ? await Camera.requestCameraPermissionsAsync() : { granted: true };
  const mic = await Camera.requestMicrophonePermissionsAsync();
  return cam.granted && mic.granted;
}

/** Check only (never shows a dialog): used inside the live room, where asking would pause the activity mid-stream. */
export async function hasLivePermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // web / iOS: granted on the Go Live screen; the browser keeps the grant
  try {
    const P = PermissionsAndroid.PERMISSIONS;
    const mic = await PermissionsAndroid.check(P.RECORD_AUDIO);
    const cam = video ? await PermissionsAndroid.check(P.CAMERA) : true;
    return mic && cam;
  } catch { return false; }
}

/** Camera (video lives) + microphone granted? Asks for whatever is missing. `quiet` skips the "Open Settings" card. */
export async function ensureLivePermissions(video: boolean, opts: { quiet?: boolean } = {}): Promise<boolean> {
  let ok = false;
  try { ok = Platform.OS === 'web' ? await web(video) : Platform.OS === 'android' ? await android(video) : await ios(video); } catch { ok = false; }
  if (ok || opts.quiet) return ok;
  const open = await showConfirm({
    title: video ? 'Allow camera & microphone' : 'Allow microphone',
    message: Platform.OS === 'web'
      ? 'Allow camera and microphone for this site in your browser settings, then try again.'
      : 'Bee Took needs these permissions to go live. Turn them on in Settings, then try again.',
    ok: Platform.OS === 'web' ? 'OK' : 'Open Settings',
  });
  if (open && Platform.OS !== 'web') void Linking.openSettings().catch(() => undefined);
  return false;
}
