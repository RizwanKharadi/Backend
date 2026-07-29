import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { AppGuideStep } from '../../constants/appGuideSteps';
import { SpotlightRect } from './AppGuideOverlay';
import FinnyMascot from './FinnyMascot';

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
  const theme = useTheme();
  const isLastStep = stepIndex === totalSteps - 1;

  return (
    <View style={[styles.container, fullScreen && styles.fullScreenContainer]}>
      <View style={styles.contentRow}>
        <FinnyMascot pose={step.mascotPose} size={fullScreen ? 124 : 90} />
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <Text variant="titleMedium" style={styles.title}>
            {step.title}
          </Text>
          <Text
            variant="bodyMedium"
            style={[styles.body, { color: theme.colors.onSurfaceVariant }]}
          >
            {step.body}
          </Text>
          <View style={styles.actions}>
            {!isLastStep ? (
              <Button mode="text" onPress={onSkip} compact>
                Skip tour
              </Button>
            ) : (
              <View />
            )}
            <Button mode="contained" onPress={onNext} compact>
              {isLastStep ? 'Get started' : 'Next'}
            </Button>
          </View>
          <Text
            variant="labelSmall"
            style={[styles.progress, { color: theme.colors.onSurfaceVariant }]}
          >
            {stepIndex + 1} of {totalSteps}
          </Text>
          {!spotlight && !fullScreen ? (
            <Text
              variant="labelSmall"
              style={[styles.fallback, { color: theme.colors.onSurfaceVariant }]}
            >
              Loading highlight...
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  fullScreenContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 48,
  },
  contentRow: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  bubble: {
    width: '100%',
    marginTop: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  title: {
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    lineHeight: 22,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progress: {
    marginTop: 12,
    textAlign: 'center',
  },
  fallback: {
    marginTop: 4,
    textAlign: 'center',
  },
});

export default GuideMascotBubble;
