import React, { Component, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Text,
  Button,
  Surface,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tSafe } from '../../i18n';
import { FinnyMascot } from '../mascot';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: any;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleRestart = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Surface style={styles.errorContainer} elevation={2}>
            {/* Concerned-but-reassuring Finny: a crash should read as
                recoverable, not alarming. No animation here — the app has
                just fallen over, a bouncing mascot would be tone-deaf. */}
            <FinnyMascot
              pose="error"
              size="md"
              animation="none"
              decorative
              style={styles.icon}
            />
            
            {/* tSafe, not useTranslation: this boundary wraps the whole app,
                so it can render before i18n has initialised — and a raw key is
                a poor thing to show someone whose app has just crashed. */}
            <Text variant="headlineSmall" style={styles.title}>
              {tSafe('errors.boundary.title', 'Something went wrong')}
            </Text>

            <Text variant="bodyLarge" style={styles.message}>
              {tSafe(
                'errors.boundary.message',
                'An unexpected error occurred. Please try restarting the app.'
              )}
            </Text>

            {__DEV__ && this.state.error && (
              <View style={styles.debugContainer}>
                <Text variant="labelMedium" style={styles.debugTitle}>
                  {tSafe('errors.boundary.debugInfo', 'Debug Info:')}
                </Text>
                <Text variant="bodySmall" style={styles.debugText}>
                  {this.state.error.toString()}
                </Text>
                {this.state.errorInfo && (
                  <Text variant="bodySmall" style={styles.debugText}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                )}
              </View>
            )}

            <View style={styles.buttonContainer}>
              <Button
                mode="contained"
                onPress={this.handleRestart}
                style={styles.button}
              >
                {tSafe('common.retry', 'Try Again')}
              </Button>
            </View>
          </Surface>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  errorContainer: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    color: '#6b7280',
  },
  debugContainer: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    width: '100%',
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#374151',
  },
  buttonContainer: {
    width: '100%',
  },
  button: {
    paddingVertical: 8,
  },
});

export default ErrorBoundary;
