import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useTheme, Button } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  showRetry?: boolean;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message,
  onRetry,
  showRetry = true
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.errorContainer }]}>
      <View style={styles.content}>
        <Icon
          name="alert-circle"
          size={24}
          color={theme.colors.error}
          style={styles.icon}
        />
        <Text style={[styles.message, { color: theme.colors.onErrorContainer }]}>
          {message}
        </Text>
      </View>
      {showRetry && onRetry && (
        <Button
          mode="outlined"
          onPress={onRetry}
          style={styles.retryButton}
          textColor={theme.colors.error}
        >{t('common.retry')}</Button>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
  },
  retryButton: {
    marginLeft: 12,
  },
});

export default ErrorMessage;