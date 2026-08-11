import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { dashboardColors } from './dashboardTheme';
import { useTranslation } from 'react-i18next';

export interface QuickActionItem {
  id: string;
  /** Literal label. Ignored when `labelKey` is set. */
  label?: string;
  /** Translation key — preferred, so the label follows the active language. */
  labelKey?: string;
  icon: string;
  color: string;
}

// Defaults live at module scope, where no hook can reach them, so they carry
// keys rather than text and are translated at render time.
const DEFAULT_ACTIONS: QuickActionItem[] = [
  { id: 'daybook', labelKey: 'dashboard.quickAction.daybook', icon: 'book-open-page-variant', color: '#3b82f6' },
  { id: 'reports', labelKey: 'dashboard.quickAction.reports', icon: 'chart-line', color: '#8b5cf6' },
  { id: 'outstanding', labelKey: 'dashboard.quickAction.outstanding', icon: 'account-clock', color: '#10b981' },
  { id: 'sync', labelKey: 'dashboard.quickAction.sync', icon: 'sync', color: '#f59e0b' },
  { id: 'vouchers', labelKey: 'dashboard.quickAction.vouchers', icon: 'receipt', color: '#6366f1' },
];

interface DashboardQuickActionsProps {
  onActionPress: (actionId: string) => void;
  actions?: QuickActionItem[];
}

const DashboardQuickActions: React.FC<DashboardQuickActionsProps> = ({
  onActionPress,
  actions = DEFAULT_ACTIONS,
}) => {
  const { t } = useTranslation();
  return (
  <View style={styles.wrapper}>
    <Text style={styles.sectionTitle}>{t('dashboard.quickActions')}</Text>
    <View style={styles.grid}>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.id}
          style={styles.cell}
          onPress={() => onActionPress(action.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${action.color}14` }]}>
            <Icon name={action.icon} size={24} color={action.color} />
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {action.labelKey ? t(action.labelKey) : action.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
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
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell: {
    width: '31%',
    backgroundColor: dashboardColors.cardBg,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
    lineHeight: 14,
  },
});

export default DashboardQuickActions;
