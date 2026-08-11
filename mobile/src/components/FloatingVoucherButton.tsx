/**
 * FloatingVoucherButton — center FAB (navy->green gradient) that opens the
 * Create New voucher screen directly. The screen itself lists every voucher
 * type, so there is no intermediate picker sheet.
 */
import React, { useRef } from 'react';
import { StyleSheet, TouchableOpacity, Animated } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { colors, gradients } from '../theme/colors';
import { shadows } from '../theme/spacing';

interface FloatingVoucherButtonProps {
  onPress: () => void;
  /** Distance from the bottom edge (above the nav bar). */
  bottomOffset?: number;
}

const FAB_SIZE = 72;

const FloatingVoucherButton: React.FC<FloatingVoucherButtonProps> = ({
  onPress,
  bottomOffset = 0,
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();

  return (
    <Animated.View
      style={[styles.fabWrap, { bottom: bottomOffset, transform: [{ scale }] }]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel="Create new"
      >
        <LinearGradient
          colors={gradients.fab}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fab, shadows.fab]}
        >
          <Icon name="plus" size={30} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 20,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.background,
  },
});

export default React.memo(FloatingVoucherButton);
