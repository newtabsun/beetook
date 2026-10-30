// One audio-session config for the whole app on native (Android/iOS). Every place that plays or
// records calls this instead of its own setAudioModeAsync, so a recorder starting later can never
// switch the session to the earpiece / ducked call mode and make game sound quiet.
import { setAudioModeAsync } from 'expo-audio';

let recording = false;

export function applyAudioMode(): Promise<void> {
  return setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: recording,
    shouldRouteThroughEarpiece: false, // always the loudspeaker / media stream
    interruptionMode: 'mixWithOthers', // no audio-focus ducking between our own players and the mic
    shouldPlayInBackground: false,
  }).catch(() => undefined);
}

/** The live "who is speaking" meter turns this on while the mic is open. */
export function setRecordingNeeded(on: boolean): Promise<void> {
  recording = on;
  return applyAudioMode();
}
