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

interface DetailScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBackPress: () => void;
  rightSlot?: React.ReactNode;
}

const DetailScreenHeader: React.FC<DetailScreenHeaderProps> = ({
  title,
  subtitle,
  onBackPress,
  rightSlot,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" backgroundColor={dashboardColors.headerTop} />
      <View style={styles.row}>
        <TouchableOpacity onPress={onBackPress} style={styles.backBtn} hitSlop={8}>
          <Icon name="arrow-left" size={22} color={dashboardColors.headerText} />
        </TouchableOpacity>
        <View style={styles.textBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: dashboardColors.headerTop,
    paddingHorizontal: 16,
    paddingBottom: 20,
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
    padding: 4,
    marginRight: 8,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: dashboardColors.headerText,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: dashboardColors.headerTextMuted,
    fontSize: 13,
    marginTop: 3,
    fontWeight: '500',
  },
  rightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
});

export default DetailScreenHeader;
