import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import { authColors } from '../../theme/authTheme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const AuthBackground: React.FC = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <View style={styles.base} />
    <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.9" />
          <Stop offset="55%" stopColor="#2563eb" stopOpacity="0.5" />
          <Stop offset="100%" stopColor="#0b1220" stopOpacity="0.2" />
        </LinearGradient>
      </Defs>
      <Circle cx={SCREEN_W * 0.85} cy={SCREEN_H * 0.08} r={120} fill={authColors.glowBlue} />
      <Circle cx={SCREEN_W * 0.1} cy={SCREEN_H * 0.22} r={90} fill={authColors.glowCyan} />
      <Circle cx={SCREEN_W * 0.5} cy={SCREEN_H * 0.35} r={160} fill="url(#heroGrad)" opacity={0.35} />
      <Path
        d={`M0 ${SCREEN_H * 0.42} Q ${SCREEN_W * 0.5} ${SCREEN_H * 0.36} ${SCREEN_W} ${SCREEN_H * 0.44} L ${SCREEN_W} 0 L 0 0 Z`}
        fill="rgba(30, 64, 175, 0.25)"
      />
    </Svg>
    <View style={styles.gridOverlay} />
  </View>
);

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: authColors.bgDeep,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.04,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
});

export default AuthBackground;
