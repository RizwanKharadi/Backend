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

interface TransactionsHeaderProps {
  subtitle?: string;
  onBackPress?: () => void;
}

const TransactionsHeader: React.FC<TransactionsHeaderProps> = ({
  subtitle = 'Browse by voucher type',
  onBackPress,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" backgroundColor={dashboardColors.headerTop} />
      <View style={styles.row}>
        {onBackPress ? (
          <TouchableOpacity onPress={onBackPress} style={styles.backBtn}>
            <Icon name="arrow-left" size={22} color={dashboardColors.headerText} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.textBlock}>
          <Text style={styles.title}>Transactions</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.decorIcon}>
          <Icon name="swap-horizontal" size={28} color="rgba(255,255,255,0.25)" />
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
  backBtn: {
    marginRight: 8,
    padding: 4,
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
  decorIcon: {
    marginLeft: 8,
  },
});

export default TransactionsHeader;
