// Drop-in replacement for react-native's <Image> for remote pictures: expo-image keeps them in the disk cache
// that Settings → Storage measures and clears (memory + disk), so avatars, covers and photos load instantly.
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

type Props = Omit<ImageProps, 'contentFit' | 'style' | 'resizeMode'> & {
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
};

export function Image({ resizeMode = 'cover', style, ...rest }: Props) {
  const fit = resizeMode === 'stretch' ? 'fill' : resizeMode === 'center' ? 'none' : resizeMode;
  return <ExpoImage cachePolicy="memory-disk" transition={0} contentFit={fit} style={style as ImageProps['style']} {...rest} />;
}
