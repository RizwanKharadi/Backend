import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ActivityIndicator,
  Text,
  useTheme,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tSafe } from '../../i18n';

interface LoadingScreenProps {
  message?: string;
  showLogo?: boolean;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message,
  showLogo = true,
}) => {
  const theme = useTheme();
  // tSafe rather than useTranslation: this screen is the PersistGate fallback,
  // so it renders before i18n has initialised.
  const label = message ?? tSafe('common.loading', 'Loading...');

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {showLogo && (
        <View style={styles.logoContainer}>
          <Icon
            name="chart-line"
            size={80}
            color={theme.colors.primary}
          />
          <Text
            variant="headlineMedium"
            style={[styles.appName, { color: theme.colors.primary }]}
          >
            {tSafe('common.appName', 'TallyFin')}
          </Text>
        </View>
      )}
      
      <View style={styles.loadingContainer}>
        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
          style={styles.spinner}
        />
        <Text
          variant="bodyLarge"
          style={[styles.message, { color: theme.colors.onSurfaceVariant }]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 16,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  spinner: {
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
  },
});

export default LoadingScreen;
