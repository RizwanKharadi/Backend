/**
 * BottomNavigation — premium bottom bar with 4 slots and a center notch for
 * the floating action button. Active tab is highlighted in brand green with an
 * indicator dot.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { DashboardTab, NavItem } from '../types/dashboard';
import { useTranslation } from 'react-i18next';

interface BottomNavigationProps {
  items: NavItem[];
  active: DashboardTab;
  onTabPress: (key: DashboardTab) => void;
}

const NAV_HEIGHT = 64;

const BottomNavigation: React.FC<BottomNavigationProps> = ({
  items,
  active,
  onTabPress,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Split items into left/right of the center FAB notch.
  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);

  const renderItem = (item: NavItem) => {
    const isActive = item.key === active;
    return (
      <TouchableOpacity
        key={item.key}
        style={styles.item}
        activeOpacity={0.7}
        onPress={() => onTabPress(item.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t(item.labelKey)}
      >
        <Icon
          name={item.icon}
          size={24}
          color={isActive ? colors.green : colors.textTertiary}
        />
        <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
          {t(item.labelKey)}
        </Text>
        {isActive ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom || spacing.sm }, shadows.nav]}>
      <View style={styles.row}>
        <View style={styles.group}>{left.map(renderItem)}</View>
        <View style={styles.centerGap} />
        <View style={styles.group}>{right.map(renderItem)}</View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    height: NAV_HEIGHT,
    alignItems: 'center',
  },
  group: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  centerGap: { width: 72 },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 60,
    paddingVertical: spacing.xxs,
  },
  label: {
    color: colors.textTertiary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  labelActive: { color: colors.green },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.green,
  },
  dotSpacer: { height: 5 },
});

export default React.memo(BottomNavigation);
