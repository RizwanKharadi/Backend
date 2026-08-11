import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardColors } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

export interface AttentionItem {
  id: string;
  message: string;
  icon: string;
  tone: 'warning' | 'error' | 'info';
  onPress?: () => void;
}

interface AttentionBannerProps {
  items: AttentionItem[];
}

const toneColors = {
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: dashboardColors.warning },
  error: { bg: '#fef2f2', border: '#fca5a5', icon: dashboardColors.negative },
  info: { bg: '#eff6ff', border: '#93c5fd', icon: dashboardColors.accent },
};

const AttentionBanner: React.FC<AttentionBannerProps> = ({ items }) => {
  const { t } = useTranslation();
  if (!items.length) return null;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionTitle}>{t('dashboard.needsAttention')}</Text>
      {items.map((item) => {
        const colors = toneColors[item.tone];
        const inner = (
          <View
            style={[
              styles.banner,
              { backgroundColor: colors.bg, borderColor: colors.border },
            ]}
          >
            <Icon name={item.icon} size={20} color={colors.icon} />
            <Text style={styles.message}>{item.message}</Text>
            {item.onPress ? (
              <Icon name="chevron-right" size={20} color={dashboardColors.muted} />
            ) : null}
          </View>
        );

        if (item.onPress) {
          return (
            <TouchableOpacity key={item.id} onPress={item.onPress} activeOpacity={0.75}>
              {inner}
            </TouchableOpacity>
          );
        }
        return <View key={item.id}>{inner}</View>;
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
  },
});

export default AttentionBanner;
