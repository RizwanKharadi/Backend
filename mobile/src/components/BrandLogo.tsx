/**
 * BrandLogo — the official TallyFin mark (vector-quality PNG asset).
 * Use across gradient headers in place of the old "TF" text monogram.
 */
import React from 'react';
import { Image, StyleSheet } from 'react-native';

interface BrandLogoProps {
  size?: number;
}

const BrandLogo: React.FC<BrandLogoProps> = ({ size = 38 }) => (
  <Image
    source={require('../assets/tallyfin-icon.png')}
    style={[styles.logo, { width: size, height: size }]}
    accessibilityLabel="TallyFin"
  />
);

const styles = StyleSheet.create({
  logo: { resizeMode: 'contain' },
});

export default React.memo(BrandLogo);
