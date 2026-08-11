import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Surface,
  Text,
  Button,
  useTheme,
} from 'react-native-paper';

interface QuickActionsProps {
  onActionPress: (action: string) => void;
}

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  color?: string;
}

// Keys, not text: this list is module scope, out of reach of any hook.
const quickActions: { id: string; labelKey: string; icon: string }[] = [
  { id: 'create_voucher', labelKey: 'dashboard.quickAction.newVoucher', icon: 'plus' },
  { id: 'create_item', labelKey: 'dashboard.quickAction.addItem', icon: 'package-variant-plus' },
  { id: 'sync', labelKey: 'dashboard.quickAction.syncNow', icon: 'sync' },
  { id: 'reports', labelKey: 'dashboard.quickAction.reports', icon: 'chart-line' },
];

const QuickActions: React.FC<QuickActionsProps> = ({ onActionPress }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={2}>
      <Text
        variant="titleMedium"
        style={[styles.title, { color: theme.colors.onSurface }]}
      >
        {t('dashboard.quickActionsTitle')}
      </Text>
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actionsContainer}
      >
        {quickActions.map((action) => (
          <Button
            key={action.id}
            mode="outlined"
            onPress={() => onActionPress(action.id)}
            icon={action.icon}
            style={[
              styles.actionButton,
              { borderColor: theme.colors.outline }
            ]}
            contentStyle={styles.actionButtonContent}
            labelStyle={styles.actionButtonLabel}
          >
            {t(action.labelKey)}
          </Button>
        ))}
      </ScrollView>
    </Surface>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  actionsContainer: {
    gap: 12,
    paddingRight: 16,
  },
  actionButton: {
    minWidth: 120,
  },
  actionButtonContent: {
    height: 48,
    flexDirection: 'column',
  },
  actionButtonLabel: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default QuickActions;
