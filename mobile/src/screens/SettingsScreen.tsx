import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import {
  Surface,
  Text,
  List,
  Switch,
  Button,
  Divider,
  useTheme,
  Dialog,
  Portal,
  TextInput,
} from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';

// Components
import Header from '../components/common/Header';
import { useAppGuide, replayAppGuide } from '../components/guide';

// Store
import { RootState, AppDispatch } from '../store';
import {
  setTheme,
  setAutoSync,
  setSyncInterval,
  setBiometricEnabled,
  setNotificationsEnabled,
  setOfflineMode,
  setDebugMode,
} from '../store/slices/settingsSlice';
import { setOfflineMode as setOfflineSliceMode } from '../store/slices/offlineSlice';
import { setOnlineStatus } from '../store/slices/syncSlice';
import { refreshConnectivityAndBackend } from '../utils/connectivity';
import { logout, setBiometricEnabled as setAuthBiometricEnabled } from '../store/slices/authSlice';

// Services
import { authService, biometricService } from '../services';
import { MDI } from '../utils/mdiIcons';

// Types
import { MainStackScreenProps } from '../types/navigation';

type Props = MainStackScreenProps<'Settings'>;

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { startGuide } = useAppGuide();
  
  const { user } = useSelector((state: RootState) => state.auth);
  const settings = useSelector((state: RootState) => state.settings);
  const { isMLServiceAvailable } = useSelector((state: RootState) => state.ml);
  const { selectedCompany } = useSelector((state: RootState) => state.company);

  const [biometricSupported, setBiometricSupported] = useState(true);
  const [biometricTypeLabel, setBiometricTypeLabel] = useState('fingerprint or face ID');
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [passwordDialogVisible, setPasswordDialogVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const syncBiometricSettingState = useCallback(async () => {
    const capabilities = await biometricService.isSupported();
    const typeLabel = await biometricService.getBiometricTypeString();
    const enabledFlag = await biometricService.isBiometricEnabled();
    const hasCredentials = await authService.hasBiometricCredentials();
    const enabled = capabilities.isSupported && enabledFlag && hasCredentials;

    setBiometricSupported(capabilities.isSupported);
    setBiometricTypeLabel(
      typeLabel !== 'Not supported' ? typeLabel.toLowerCase() : 'fingerprint or face ID'
    );
    dispatch(setBiometricEnabled(enabled));
    dispatch(setAuthBiometricEnabled(enabled));
  }, [dispatch]);

  useEffect(() => {
    void syncBiometricSettingState();
  }, [syncBiometricSettingState]);

  const applyBiometricEnabled = (enabled: boolean) => {
    dispatch(setBiometricEnabled(enabled));
    dispatch(setAuthBiometricEnabled(enabled));
  };

  const finalizeBiometricEnable = async (password: string) => {
    if (!user?.email) {
      Alert.alert('Error', 'Sign in again before enabling biometric authentication.');
      return;
    }

    setBiometricBusy(true);
    try {
      await authService.enableBiometricLogin({
        email: user.email.toLowerCase().trim(),
        password: password.trim(),
        rememberMe: true,
      });
      await biometricService.markBiometricEnabled();
      applyBiometricEnabled(true);
      Alert.alert(
        'Biometric enabled',
        `You can sign in with ${biometricTypeLabel} on the login screen.`
      );
    } catch (error: any) {
      Alert.alert(
        'Setup failed',
        error?.message || 'Could not enable biometric authentication.'
      );
    } finally {
      setBiometricBusy(false);
      setPasswordDialogVisible(false);
      setPasswordInput('');
    }
  };

  const promptPasswordAndEnable = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Confirm password',
        'Enter your account password to enable biometric sign-in.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enable',
            onPress: (value) => {
              if (value?.trim()) {
                void finalizeBiometricEnable(value.trim());
              }
            },
          },
        ],
        'secure-text'
      );
      return;
    }
    setPasswordInput('');
    setPasswordDialogVisible(true);
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (biometricBusy) return;

    if (!value) {
      setBiometricBusy(true);
      try {
        await biometricService.disableBiometric();
        await authService.clearBiometricCredentials();
        applyBiometricEnabled(false);
      } catch (error: any) {
        Alert.alert(
          'Error',
          error?.message || 'Could not disable biometric authentication.'
        );
      } finally {
        setBiometricBusy(false);
      }
      return;
    }

    const capabilities = await biometricService.isSupported();
    if (!capabilities.isSupported) {
      Alert.alert(
        'Not available',
        'This device does not support fingerprint or face authentication.'
      );
      return;
    }

    if (!user?.email) {
      Alert.alert('Sign in required', 'Log in with your password before enabling biometrics.');
      return;
    }

    setBiometricBusy(true);
    try {
      const biometricType = await biometricService.getBiometricTypeString();
      await biometricService.authenticate({
        title: 'Enable biometric login',
        description: `Authenticate with ${biometricType} to continue`,
      });
      promptPasswordAndEnable();
    } catch (error: any) {
      const msg = (error?.message || '').toLowerCase();
      if (!msg.includes('cancel')) {
        Alert.alert(
          'Authentication failed',
          error?.message || 'Biometric verification was not completed.'
        );
      }
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: () => dispatch(logout()),
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // TODO: Implement cache clearing
            Alert.alert('Success', 'Cache cleared successfully');
          },
        },
      ]
    );
  };

  const handleShowAppTour = () => {
    navigation.goBack();
    setTimeout(() => {
      navigation.navigate('Tabs', { screen: 'Dashboard' });
      replayAppGuide(dispatch, startGuide);
    }, 300);
  };

  return (
    <View style={styles.container}>
      <Header
        title="Settings"
        subtitle="App Configuration"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Section */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Account</Text>
          
          <List.Item
            title={user?.name || 'User'}
            description={user?.email || 'No email'}
            left={(props) => <List.Icon {...props} icon="account" />}
            onPress={() => navigation.navigate('Profile')}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <Divider />
          
          <List.Item
            title="Subscription & billing"
            description="Manage plan and device seats (mobile included)"
            left={(props) => <List.Icon {...props} icon="credit-card" />}
            onPress={() => navigation.navigate('Billing')}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />

          <Divider />

          <List.Item
            title="Company selection"
            description={
              selectedCompany?.name
                ? `Active: ${selectedCompany.name}`
                : 'Choose which workspace to view'
            }
            left={(props) => <List.Icon {...props} icon="office-building" />}
            onPress={() => navigation.navigate('CompanySelection')}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* Sync Settings */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Synchronization</Text>
          
          <List.Item
            title="Auto Sync"
            description="Automatically sync when online"
            left={(props) => <List.Icon {...props} icon="sync" />}
            right={() => (
              <Switch
                value={settings.autoSync}
                onValueChange={(value: boolean) => {
                  dispatch(setAutoSync(value));
                }}
              />
            )}
          />
          
          <List.Item
            title="Sync Interval"
            description={`Every ${settings.syncInterval} minutes`}
            left={(props) => <List.Icon {...props} icon="clock" />}
            onPress={() => {
              // TODO: Show interval picker
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title="Offline Mode"
            description="Work offline with local data"
            left={(props) => <List.Icon {...props} icon="cloud-off" />}
            right={() => (
              <Switch
                value={settings.offlineMode}
                onValueChange={(value: boolean) => {
                  dispatch(setOfflineMode(value));
                  dispatch(setOfflineSliceMode(value));
                  if (!value) {
                    void refreshConnectivityAndBackend();
                  } else {
                    dispatch(setOnlineStatus(false));
                  }
                }}
              />
            )}
          />
        </Surface>

        {/* Security Settings */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Security</Text>
          
          <List.Item
            title="Biometric Authentication"
            description={
              biometricSupported
                ? `Sign in with ${biometricTypeLabel}`
                : 'Not supported on this device'
            }
            left={(props) => <List.Icon {...props} icon="fingerprint" />}
            right={() => (
              <Switch
                value={settings.biometricEnabled}
                disabled={!biometricSupported || biometricBusy}
                onValueChange={handleBiometricToggle}
              />
            )}
          />
        </Surface>

        {/* App Settings */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>App Settings</Text>
          
          <List.Item
            title="Theme"
            description={`${settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)} theme`}
            left={(props) => <List.Icon {...props} icon="palette" />}
            onPress={() => {
              // TODO: Show theme picker
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title="Notifications"
            description="Push notifications and alerts"
            left={(props) => <List.Icon {...props} icon="bell" />}
            right={() => (
              <Switch
                value={settings.notificationsEnabled}
                onValueChange={(value: boolean) => {
                  dispatch(setNotificationsEnabled(value));
                }}
              />
            )}
          />
          
          <List.Item
            title="Debug Mode"
            description="Enable debug logging"
            left={(props) => <List.Icon {...props} icon="bug" />}
            right={() => (
              <Switch
                value={settings.debugMode}
                onValueChange={(value: boolean) => {
                  dispatch(setDebugMode(value));
                }}
              />
            )}
          />
        </Surface>

        {/* ML Settings */}
        {isMLServiceAvailable && (
          <Surface style={styles.section} elevation={2}>
            <Text variant="titleMedium" style={styles.sectionTitle}>AI/ML Features</Text>
            
            <List.Item
              title="Payment Predictions"
              description="AI payment delay predictions"
              left={(props) => <List.Icon {...props} icon={MDI.mlCrystal} />}
              onPress={() => navigation.navigate('PaymentPrediction')}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Surface>
        )}

        {/* Data Management */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Data Management</Text>
          
          <List.Item
            title="Clear Cache"
            description="Clear all cached data"
            left={(props) => <List.Icon {...props} icon="delete" />}
            onPress={handleClearCache}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title="Export Data"
            description="Export app data"
            left={(props) => <List.Icon {...props} icon={MDI.exportData} />}
            onPress={() => {
              // TODO: Implement data export
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* Help */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>Help</Text>

          <List.Item
            title="Show app tour"
            description="Replay Finny's guided walkthrough of the app"
            left={(props) => <List.Icon {...props} icon="map-marker-path" />}
            onPress={handleShowAppTour}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* About Section */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>About</Text>
          
          <List.Item
            title="App Version"
            description="1.0.0"
            left={(props) => <List.Icon {...props} icon="information" />}
          />
          
          <List.Item
            title="Privacy Policy"
            description="View privacy policy"
            left={(props) => <List.Icon {...props} icon="shield-account" />}
            onPress={() => {
              // TODO: Open privacy policy
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title="Terms of Service"
            description="View terms of service"
            left={(props) => <List.Icon {...props} icon="file-document" />}
            onPress={() => {
              // TODO: Open terms of service
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* Logout Button */}
        <View style={styles.logoutContainer}>
          <Button
            mode="outlined"
            onPress={handleLogout}
            icon="logout"
            style={[styles.logoutButton, { borderColor: theme.colors.error }]}
            textColor={theme.colors.error}
          >
            Logout
          </Button>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>

      <Portal>
        <Dialog
          visible={passwordDialogVisible}
          onDismiss={() => {
            if (!biometricBusy) {
              setPasswordDialogVisible(false);
              setPasswordInput('');
            }
          }}
        >
          <Dialog.Title>Confirm password</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogHint}>
              Enter your account password to store credentials for biometric sign-in.
            </Text>
            <TextInput
              label="Password"
              value={passwordInput}
              onChangeText={setPasswordInput}
              secureTextEntry
              autoCapitalize="none"
              mode="outlined"
              style={styles.passwordInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setPasswordDialogVisible(false);
                setPasswordInput('');
              }}
              disabled={biometricBusy}
            >
              Cancel
            </Button>
            <Button
              onPress={() => {
                if (!passwordInput.trim()) {
                  Alert.alert('Password required', 'Enter your account password.');
                  return;
                }
                void finalizeBiometricEnable(passwordInput.trim());
              }}
              loading={biometricBusy}
              disabled={biometricBusy}
            >
              Enable
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  logoutContainer: {
    marginTop: 16,
    marginBottom: 16,
  },
  logoutButton: {
    paddingVertical: 8,
  },
  bottomSpacing: {
    height: 20,
  },
  dialogHint: {
    marginBottom: 12,
  },
  passwordInput: {
    marginTop: 4,
  },
});

export default SettingsScreen;
