import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

/**
 * Placeholder for Chat / Ask Your Business — production build shows Coming Soon.
 */
const ComingSoonScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={3}>
        <View style={styles.iconWrap}>
          <Icon name="chat-processing-outline" size={48} color={dashboardColors.accent} />
        </View>
        <Text style={styles.title}>Coming Soon</Text>
        <Text style={styles.subtitle}>
          AI chat for your business data is under development. You can continue using Dashboard,
          Transactions, Inventory, and Reports.
        </Text>
        <View style={styles.badge}>
          <Icon name="hammer-wrench" size={16} color="#64748b" />
          <Text style={styles.badgeText}>Available in a future update</Text>
        </View>
      </Surface>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    backgroundColor: dashboardColors.cardBg,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: dashboardColors.muted,
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
});

export default ComingSoonScreen;
