/**
 * The Finny card shown on each App Tour step.
 *
 * All copy here is ENGLISH ONLY and intentionally not routed through i18n —
 * including the Skip / Next / Get Started chrome. The App Tour is brand voice.
 * The one non-English string is the TallyFin tagline, which is a brand asset.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { AppGuideStep, TALLYFIN_TAGLINE } from '../../constants/appGuideSteps';
import { SpotlightRect } from './AppGuideOverlay';
import FinnyMascot from '../mascot/FinnyMascot';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { fontSize, fontWeight } from '../../theme/typography';

interface GuideMascotBubbleProps {
  step: AppGuideStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
  fullScreen?: boolean;
  spotlight?: SpotlightRect | null;
}

const GuideMascotBubble: React.FC<GuideMascotBubbleProps> = ({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onSkip,
  fullScreen = false,
  spotlight = null,
}) => {
  const isLastStep = stepIndex === totalSteps - 1;

  // Finny waves on the intro, celebrates on the outro, and drifts gently while
  // pointing so he does not compete with the highlighted control.
  const animation = step.fullScreen
    ? isLastStep
      ? 'celebrate'
      : 'wave'
    : 'float';

  return (
    <View style={[styles.container, fullScreen && styles.fullScreenContainer]}>
      <View style={styles.contentRow}>
        <FinnyMascot
          pose={step.mascotPose}
          size={fullScreen ? 'xl' : 'md'}
          animation={animation}
          decorative
        />

        <View style={styles.bubble}>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          {step.showTagline ? (
            <Text style={styles.tagline}>{TALLYFIN_TAGLINE}</Text>
          ) : null}

          <View style={styles.actions}>
            {!isLastStep ? (
              <Button
                mode="text"
                onPress={onSkip}
                compact
                textColor={colors.textSecondary}
              >
                Skip tour
              </Button>
            ) : (
              <View />
            )}
            <Button
              mode="contained"
              onPress={onNext}
              buttonColor={colors.green}
              style={styles.cta}
            >
              {step.ctaLabel ?? (isLastStep ? 'Get Started' : 'Next')}
            </Button>
          </View>

          <View style={styles.dots}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === stepIndex && styles.dotActive]}
              />
            ))}
          </View>

          {!spotlight && !fullScreen ? (
            <Text style={styles.fallback}>Finding it on screen…</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  fullScreenContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.xxxl,
  },
  contentRow: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  bubble: {
    width: '100%',
    marginTop: -spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  tagline: {
    marginTop: spacing.sm,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.green,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  cta: {
    borderRadius: radius.sm,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: colors.green,
  },
  fallback: {
    marginTop: spacing.xs,
    textAlign: 'center',
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
});

export default GuideMascotBubble;
