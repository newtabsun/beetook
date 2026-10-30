// Device class used to scale background work (preloading) on weaker phones.
import { Platform } from 'react-native';

let total: number | null = null;
try {
  // Optional native module: an app build without expo-device simply treats the phone as a normal one.
  total = (require('expo-device') as { totalMemory: number | null }).totalMemory;
} catch {
  total = null;
}

/** Android/iOS phones with less than 3 GB of RAM. Always false on web. */
export const isLowMemoryDevice = Platform.OS !== 'web' && total != null && total < 3 * 1024 ** 3;

/** Same < 3 GB rule, extended to phone browsers through navigator.deviceMemory (reported as 0.25…8 GB). */
const webMemoryGb = Platform.OS === 'web' && typeof navigator !== 'undefined'
  ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  : undefined;
export const isLowEndDevice = isLowMemoryDevice || (webMemoryGb != null && webMemoryGb < 3);
