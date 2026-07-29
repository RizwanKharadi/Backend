/**
 * FloatingVoucherButton — center FAB (navy->green gradient) that opens a
 * bottom sheet of voucher creation options. Sheet slides up with Animated and
 * dims the background; tap scrim or an option to dismiss.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  Pressable,
  ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gradients, hexToRgba } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { VoucherKey, VoucherOption } from '../types/dashboard';

interface FloatingVoucherButtonProps {
  options: VoucherOption[];
  onSelect: (key: VoucherKey) => void;
  /** Distance from the bottom edge (above the nav bar). */
  bottomOffset?: number;
}

const FAB_SIZE = 72;

const FloatingVoucherButton: React.FC<FloatingVoucherButtonProps> = ({
  options,
  onSelect,
  bottomOffset = 0,
}) => {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const animateSheet = useCallback(
    (toValue: number, cb?: () => void) => {
      Animated.timing(sheetAnim, {
        toValue,
        duration: toValue ? 280 : 200,
        easing: toValue ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && cb?.());
    },
    [sheetAnim]
  );

  useEffect(() => {
    if (open) animateSheet(1);
  }, [open, animateSheet]);

  const close = useCallback(() => {
    animateSheet(0, () => setOpen(false));
  }, [animateSheet]);

  const handleSelect = useCallback(
    (key: VoucherKey) => {
      animateSheet(0, () => {
        setOpen(false);
        onSelect(key);
      });
    },
    [animateSheet, onSelect]
  );

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();

  const translateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <>
      <Animated.View
        style={[styles.fabWrap, { bottom: bottomOffset, transform: [{ scale }] }]}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => setOpen(true)}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          accessibilityRole="button"
          accessibilityLabel="Create voucher"
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

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <Pressable style={styles.scrim} onPress={close}>
          <Animated.View style={[styles.scrimFill, { opacity: sheetAnim }]} />
        </Pressable>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Create Voucher</Text>

          <ScrollView
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {options.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={styles.option}
                activeOpacity={0.8}
                onPress={() => handleSelect(opt.key)}
                accessibilityRole="button"
                accessibilityLabel={opt.title}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: hexToRgba(opt.color, 0.14) }]}
                >
                  <Icon name={opt.icon} size={24} color={opt.color} />
                </View>
                <Text style={styles.optionText} numberOfLines={2}>
                  {opt.title}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      </Modal>
    </>
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
  scrim: { ...StyleSheet.absoluteFillObject },
  scrimFill: { flex: 1, backgroundColor: 'rgba(3, 9, 23, 0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxHeight: '70%',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  option: {
    width: '23%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  optionIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    lineHeight: 13,
  },
});

export default React.memo(FloatingVoucherButton);
