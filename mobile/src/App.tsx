import React, { useEffect } from 'react';
import { StatusBar, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import { Provider as ReduxProvider, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import Toast from 'react-native-toast-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Store and Navigation
import { store, persistor, RootState } from './store';
import { validateSession } from './store/slices/authSlice';
import AppNavigator from './navigation/AppNavigator';

// i18n
import { initI18n } from './i18n';

// Services
import { initializeServices } from './services';

// Theme and Components
import { theme } from './theme';
import LoadingScreen from './components/common/LoadingScreen';
import ErrorBoundary from './components/common/ErrorBoundary';

// Utils
import { setupNetworkListener } from './utils/networkUtils';
import { refreshConnectivityAndBackend } from './utils/connectivity';
import { initializeDatabase } from './utils/databaseUtils';

// Ignore specific warnings for development
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'VirtualizedLists should never be nested',
]);

/**
 * Remounts the navigator when the language changes.
 *
 * Translated strings re-render on their own through react-i18next, but figures
 * do not: `formatCurrency` and friends are plain function calls inside
 * components that react-i18next knows nothing about, so a memoised screen would
 * keep showing amounts grouped in the old language. Keying the tree on the
 * language is the one change that guarantees every rendered figure is rebuilt.
 */
const LocalizedNavigator: React.FC = () => {
  const language = useSelector((state: RootState) => state.settings.language);
  return <AppNavigator key={language} />;
};

const App: React.FC = () => {
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Initialize local database
        await initializeDatabase();
        
        // Initialize services
        await initializeServices();
        
        // Setup network monitoring
        setupNetworkListener();
        
        console.log('FinSync360 Mobile App initialized successfully');
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };

    initializeApp();
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ReduxProvider store={store}>
            <PersistGate
              loading={<LoadingScreen />}
              persistor={persistor}
              onBeforeLift={async () => {
                // Language is persisted, so it is only known once rehydration
                // has run. Initialise i18n here to avoid a first paint in the
                // wrong language.
                await initI18n(store.getState().settings?.language);
                store.dispatch(validateSession());
                void refreshConnectivityAndBackend();
              }}
            >
              <PaperProvider theme={theme}>
                <NavigationContainer>
                  <StatusBar
                    barStyle="dark-content"
                    backgroundColor={theme.colors.surface}
                    translucent={false}
                  />
                  <LocalizedNavigator />
                  <Toast />
                </NavigationContainer>
              </PaperProvider>
            </PersistGate>
          </ReduxProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
};

export default App;
