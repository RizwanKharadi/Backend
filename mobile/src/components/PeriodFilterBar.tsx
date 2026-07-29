/**
 * PeriodFilterBar — segmented control (Today / This Week / This Month /
 * Custom) with an animated sliding indicator.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  LayoutChangeEvent,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { PeriodKey, PERIOD_OPTIONS } from '../utils/transactionPeriods';

interface PeriodFilterBarProps {
  active: PeriodKey;
  onChange: (key: PeriodKey) => void;
}

const PAD = 4;

const PeriodFilterBar: React.FC<PeriodFilterBarProps> = ({ active, onChange }) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const segWidth = trackWidth > 0 ? (trackWidth - PAD * 2) / PERIOD_OPTIONS.length : 0;
  const activeIndex = PERIOD_OPTIONS.findIndex((o) => o.key === active);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: Math.max(0, activeIndex) * segWidth,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeIndex, segWidth, translateX]);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={onLayout}>
      {segWidth > 0 ? (
        <Animated.View
          style={[
            styles.indicator,
            { width: segWidth, transform: [{ translateX }] },
            shadows.card,
          ]}
        />
      ) : null}
      {PERIOD_OPTIONS.map((opt) => {
        const isActive = opt.key === active;
        return (
          <TouchableOpacity
            key={opt.key}
            style={styles.segment}
            activeOpacity={0.8}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            {opt.key === 'custom' ? (
              <Icon
                name="calendar-range"
                size={14}
                color={isActive ? colors.white : colors.textSecondary}
                style={styles.segIcon}
              />
            ) : null}
            <Text style={[styles.segText, isActive && styles.segTextActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: PAD,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
    backgroundColor: colors.navy,
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.xs + 2,
  },
  segIcon: {},
  segText: {
    color: colors.textSecondary,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
  },
  segTextActive: { color: colors.white, fontWeight: fontWeight.bold },
});

export default React.memo(PeriodFilterBar);
