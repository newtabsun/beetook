// Modal constrained to the phone frame (max 430px, centered) so sheets never stretch on wide web screens.
import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { KeyboardInset } from './KeyboardInset';
import { DialogHost } from './DialogHost';

export function AppModal({ children, onRequestClose, animationType = 'slide' }: { children: ReactNode; onRequestClose: () => void; animationType?: 'slide' | 'fade' | 'none' }) {
  return (
    <Modal visible transparent animationType={animationType} onRequestClose={onRequestClose}>
      <KeyboardInset style={s.back}><View style={s.frame}>{children}<DialogHost /></View></KeyboardInset>
    </Modal>
  );
}
const s = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  frame: { flex: 1, width: '100%', maxWidth: 430 },
});
