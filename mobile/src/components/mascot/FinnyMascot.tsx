/**
 * Finny — the one component every screen uses to show the mascot.
 *
 * Callers pass a semantic pose and a named size; the artwork mapping lives in
 * finnyPoses.ts. Nothing outside this folder should `require()` a mascot PNG.
 *
 * Animation is deliberately restrained. Finny is a business companion, not a
 * loading spinner: a slow float and an occasional wave, nothing that pulls the
 * eye away from the numbers. Motion also stops entirely when the OS asks for
 * reduced motion, and unmounts cleanly so a backgrounded screen is not
 * animating a view nobody is looking at.
 */
import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  FINNY_ART_READY,
  FINNY_ASPECT_RATIO,
  FINNY_POSES,
  FINNY_SIZES,
  type FinnyPose,
  type FinnySize,
} from './finnyPoses';

export type FinnyAnimation = 'none' | 'float' | 'wave' | 'celebrate';

interface FinnyMascotProps {
  pose: FinnyPose;
  /** Named size or an explicit **height** in px; width follows the 2:3 art. */
  size?: FinnySize | number;
  animation?: FinnyAnimation;
  style?: ViewStyle;
  /** Finny is decorative next to text that already says the same thing. */
  decorative?: boolean;
}

const FinnyMascot: React.FC<FinnyMascotProps> = ({
  pose,
  size = 'md',
  animation = 'float',
  style,
  decorative = false,
}) => {
  const height = typeof size === 'number' ? size : FINNY_SIZES[size];
  const width = Math.round(height * FINNY_ASPECT_RATIO);
  const definition = FINNY_POSES[pose] ?? FINNY_POSES.welcome;
  // Hooks must run unconditionally, so the art check gates the render, not the
  // component body.
  const artReady = FINNY_ART_READY;

  const drift = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (animation === 'none') return undefined;

    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;

    const start = (reduceMotion: boolean) => {
      if (cancelled || reduceMotion) return;

      if (animation === 'float') {
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(drift, {
              toValue: 1,
              duration: 2200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(drift, {
              toValue: 0,
              duration: 2200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        );
      } else if (animation === 'wave') {
        // Float, plus a small tilt that fires every few seconds rather than
        // continuously — a constant wave reads as frantic.
        loop = Animated.loop(
          Animated.sequence([
            Animated.delay(1600),
            Animated.timing(tilt, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(tilt, {
              toValue: -1,
              duration: 260,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(tilt, {
              toValue: 0,
              duration: 220,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ])
        );
      } else {
        // celebrate — one bounce on mount, not a loop.
        loop = Animated.sequence([
          Animated.spring(pop, {
            toValue: 1,
            friction: 4,
            tension: 90,
            useNativeDriver: true,
          }),
        ]);
      }

      loop.start();
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then(start)
      .catch(() => start(false));

    return () => {
      cancelled = true;
      loop?.stop();
      drift.setValue(0);
      tilt.setValue(0);
      pop.setValue(0);
    };
  }, [animation, drift, tilt, pop]);

  const transform: Animated.WithAnimatedValue<ViewStyle>['transform'] = [];
  if (animation === 'float' || animation === 'wave') {
    transform.push({
      translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) as never,
    });
  }
  if (animation === 'wave') {
    transform.push({
      rotate: tilt.interpolate({
        inputRange: [-1, 1],
        outputRange: ['-4deg', '4deg'],
      }) as never,
    });
  }
  if (animation === 'celebrate') {
    transform.push({
      scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) as never,
    });
  }

  // Better no mascot than the wrong mascot — every surface that uses Finny also
  // carries its own text, so this degrades to a clean text-only state.
  if (!artReady) return null;

  return (
    <Animated.View
      style={[styles.wrapper, { width, height }, { transform }, style]}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      <Image
        source={definition.source}
        style={styles.image}
        resizeMode="contain"
        accessible={!decorative}
        accessibilityRole="image"
        accessibilityLabel={decorative ? undefined : definition.label}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

export default FinnyMascot;

/** Convenience wrapper: Finny as a small round avatar beside a line of text. */
export const FinnyAvatar: React.FC<{ pose?: FinnyPose; size?: number }> = ({
  pose = 'help',
  size = FINNY_SIZES.xs,
}) => (
  <View style={styles.wrapper}>
    <FinnyMascot pose={pose} size={size} animation="none" decorative />
  </View>
);
