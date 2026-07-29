import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Platform,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dashboardColors } from '../dashboard/dashboardTheme';

interface ReportsHeaderProps {
  subtitle?: string;
  onSyncPress?: () => void;
  onSettingsPress?: () => void;
}

const ReportsHeader: React.FC<ReportsHeaderProps> = ({
  subtitle = 'Business intelligence from Tally',
  onSyncPress,
  onSettingsPress,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" backgroundColor={dashboardColors.headerTop} />
      <View style={styles.row}>
        <View style={styles.textBlock}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {onSyncPress ? (
          <TouchableOpacity onPress={onSyncPress} style={styles.iconBtn} hitSlop={8}>
            <Icon name="sync" size={22} color={dashboardColors.headerText} />
          </TouchableOpacity>
        ) : null}
        {onSettingsPress ? (
          <TouchableOpacity onPress={onSettingsPress} style={styles.iconBtn} hitSlop={8}>
            <Icon name="cog-outline" size={22} color={dashboardColors.headerText} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.decorIcon}>
          <Icon name="chart-line" size={28} color="rgba(255,255,255,0.25)" />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: dashboardColors.headerTop,
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: dashboardColors.headerText,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: dashboardColors.headerTextMuted,
    fontSize: 14,
    marginTop: 4,
    fontWeight: '500',
  },
  iconBtn: {
    padding: 8,
    marginRight: 2,
  },
  decorIcon: {
    marginLeft: 4,
  },
});

export default ReportsHeader;
