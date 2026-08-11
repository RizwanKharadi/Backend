import React from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { AppGuideStep } from '../../constants/appGuideSteps';
import GuideMascotBubble from './GuideMascotBubble';

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AppGuideOverlayProps {
  visible: boolean;
  step: AppGuideStep;
  stepIndex: number;
  totalSteps: number;
  spotlight: SpotlightRect | null;
  onNext: () => void;
  onSkip: () => void;
}

const PADDING = 10;
const screen = Dimensions.get('window');
const SCREEN_WIDTH = screen.width;
const SCREEN_HEIGHT = screen.height;

const AppGuideOverlay: React.FC<AppGuideOverlayProps> = ({
  visible,
  step,
  stepIndex,
  totalSteps,
  spotlight,
  onNext,
  onSkip,
}) => {
  if (!visible) return null;

  const isFullScreen = step.fullScreen || !spotlight;
  const hole = spotlight
    ? {
        x: Math.max(0, spotlight.x - PADDING),
        y: Math.max(0, spotlight.y - PADDING),
        width: Math.min(SCREEN_WIDTH, spotlight.width + PADDING * 2),
        height: spotlight.height + PADDING * 2,
      }
    : null;

  // Keep the card clear of whatever it is pointing at: above the bottom bar for
  // nav steps, and below a target that sits in the top third of the screen.
  const targetIsBottomBar =
    step.targetId === 'bottom-nav' || step.targetId === 'tab-bar';
  const targetIsHigh = !!spotlight && spotlight.y < SCREEN_HEIGHT * 0.34;
  const bubblePosition = targetIsBottomBar
    ? { bottom: 108 }
    : targetIsHigh
      ? { top: Math.min(SCREEN_HEIGHT * 0.42, (spotlight?.y ?? 0) + (spotlight?.height ?? 0) + 28) }
      : { bottom: 24 };

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable style={styles.touchBlocker} pointerEvents="auto">
        {!isFullScreen && hole ? (
          <>
            <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT} style={StyleSheet.absoluteFill}>
              <Defs>
                <Mask id={`guideSpotlightMask-${step.id}`}>
                  <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="white" />
                  <Rect
                    x={hole.x}
                    y={hole.y}
                    width={hole.width}
                    height={hole.height}
                    rx={12}
                    ry={12}
                    fill="black"
                  />
                </Mask>
              </Defs>
              <Rect
                x="0"
                y="0"
                width={SCREEN_WIDTH}
                height={SCREEN_HEIGHT}
                fill="rgba(0,0,0,0.72)"
                mask={`url(#guideSpotlightMask-${step.id})`}
              />
            </Svg>
            <View
              pointerEvents="none"
              style={[
                styles.highlightRing,
                {
                  left: hole.x,
                  top: hole.y,
                  width: hole.width,
                  height: hole.height,
                },
              ]}
            />
          </>
        ) : (
          <View style={styles.fullScreenDim} />
        )}
      </Pressable>

      <View
        pointerEvents="auto"
        style={[
          styles.bubbleWrapper,
          isFullScreen && styles.bubbleWrapperCenter,
          !isFullScreen && bubblePosition,
        ]}
      >
        <GuideMascotBubble
          step={step}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onNext={onNext}
          onSkip={onSkip}
          fullScreen={isFullScreen}
          spotlight={spotlight}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  touchBlocker: {
    ...StyleSheet.absoluteFillObject,
  },
  fullScreenDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  highlightRing: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  bubbleWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 12,
  },
  bubbleWrapperCenter: {
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});

export default AppGuideOverlay;
