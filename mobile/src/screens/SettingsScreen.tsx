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
  setLanguage,
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

// i18n
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';
import { findLanguage } from '../i18n/languages';
import LanguagePickerDialog from '../components/settings/LanguagePickerDialog';

type Props = MainStackScreenProps<'Settings'>;

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { startGuide } = useAppGuide();
  const { t } = useTranslation();
  
  const { user } = useSelector((state: RootState) => state.auth);
  const settings = useSelector((state: RootState) => state.settings);
  const { isMLServiceAvailable } = useSelector((state: RootState) => state.ml);
  const { selectedCompany } = useSelector((state: RootState) => state.company);

  const [biometricSupported, setBiometricSupported] = useState(true);
  const [biometricTypeLabel, setBiometricTypeLabel] = useState('fingerprint or face ID');
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [passwordDialogVisible, setPasswordDialogVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [languageDialogVisible, setLanguageDialogVisible] = useState(false);

  const currentLanguageName =
    findLanguage(settings.language)?.nativeName ?? settings.language;

  const handleLanguageSelect = useCallback(
    async (code: string) => {
      // changeLanguage is the authority: it falls back to English if the
      // requested language has no translation file, and returns what it
      // actually applied. Store that, not what was asked for.
      const applied = await changeLanguage(code);
      dispatch(setLanguage(applied));
    },
    [dispatch]
  );

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
      Alert.alert(t('common.error'), t('settings.biometric.signInAgain'));
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
        t('settings.biometric.enabledTitle'),
        t('settings.biometric.enabledMessage', { type: biometricTypeLabel })
      );
    } catch (error: any) {
      Alert.alert(
        t('settings.biometric.setupFailed'),
        error?.message || t('settings.biometric.couldNotEnable')
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
        t('settings.biometric.confirmPassword'),
        t('settings.biometric.confirmPasswordMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.biometric.enable'),
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
          t('common.error'),
          error?.message || t('settings.biometric.couldNotDisable')
        );
      } finally {
        setBiometricBusy(false);
      }
      return;
    }

    const capabilities = await biometricService.isSupported();
    if (!capabilities.isSupported) {
      Alert.alert(
        t('settings.biometric.notAvailable'),
        t('settings.biometric.notSupported')
      );
      return;
    }

    if (!user?.email) {
      Alert.alert(t('settings.biometric.signInRequired'), t('settings.biometric.signInFirst'));
      return;
    }

    setBiometricBusy(true);
    try {
      const biometricType = await biometricService.getBiometricTypeString();
      await biometricService.authenticate({
        title: t('settings.biometric.enableTitle'),
        description: t('settings.biometric.authenticateWith', { type: biometricType }),
      });
      promptPasswordAndEnable();
    } catch (error: any) {
      const msg = (error?.message || '').toLowerCase();
      if (!msg.includes('cancel')) {
        Alert.alert(
          t('settings.biometric.authFailed'),
          error?.message || t('settings.biometric.notCompleted')
        );
      }
    } finally {
      setBiometricBusy(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      t('settings.logout.title'),
      t('settings.logout.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.logout.confirm'),
          style: 'destructive',
          onPress: () => dispatch(logout()),
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      t('settings.cache.title'),
      t('settings.cache.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.cache.confirm'),
          style: 'destructive',
          onPress: () => {
            // TODO: Implement cache clearing
            Alert.alert(t('common.success'), t('settings.cache.success'));
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
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Section */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionAccount')}</Text>
          
          <List.Item
            title={user?.name || 'User'}
            description={user?.email || 'No email'}
            left={(props) => <List.Icon {...props} icon="account" />}
            onPress={() => navigation.navigate('Profile')}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <Divider />
          
          <List.Item
            title={t('settings.billing.title')}
            description={t('settings.billing.description')}
            left={(props) => <List.Icon {...props} icon="credit-card" />}
            onPress={() => navigation.navigate('Billing')}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />

          <Divider />

          <List.Item
            title={t('settings.companySelection')}
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
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionSync')}</Text>
          
          <List.Item
            title={t('settings.autoSync.title')}
            description={t('settings.autoSync.description')}
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
            title={t('settings.syncInterval')}
            description={`Every ${settings.syncInterval} minutes`}
            left={(props) => <List.Icon {...props} icon="clock" />}
            onPress={() => {
              // TODO: Show interval picker
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title={t('settings.offlineMode.title')}
            description={t('settings.offlineMode.description')}
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
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionSecurity')}</Text>
          
          <List.Item
            title={t('settings.biometric.title')}
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
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionApp')}</Text>
          
          <List.Item
            title={t('settings.theme')}
            description={t('settings.themeValue', {
              name: t(`settings.themeName.${settings.theme}`),
            })}
            left={(props) => <List.Icon {...props} icon="palette" />}
            onPress={() => {
              // TODO: Show theme picker
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title={t('settings.language.title')}
            description={currentLanguageName}
            left={(props) => <List.Icon {...props} icon="translate" />}
            onPress={() => setLanguageDialogVisible(true)}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />

          <List.Item
            title={t('settings.notifications')}
            description={t('settings.notificationsDescription')}
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
            title={t('settings.debugMode')}
            description={t('settings.debugModeDescription')}
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
            <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionAi')}</Text>
            
            <List.Item
              title={t('settings.paymentPredictions.title')}
              description={t('settings.paymentPredictions.description')}
              left={(props) => <List.Icon {...props} icon={MDI.mlCrystal} />}
              onPress={() => navigation.navigate('PaymentPrediction')}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Surface>
        )}

        {/* Data Management */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionData')}</Text>
          
          <List.Item
            title={t('settings.cache.title')}
            description={t('settings.cache.description')}
            left={(props) => <List.Icon {...props} icon="delete" />}
            onPress={handleClearCache}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title={t('settings.export.title')}
            description={t('settings.export.description')}
            left={(props) => <List.Icon {...props} icon={MDI.exportData} />}
            onPress={() => {
              // TODO: Implement data export
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* Help */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionHelp')}</Text>

          <List.Item
            title={t('settings.appTour.title')}
            description={t('settings.appTour.description')}
            left={(props) => <List.Icon {...props} icon="map-marker-path" />}
            onPress={handleShowAppTour}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
        </Surface>

        {/* About Section */}
        <Surface style={styles.section} elevation={2}>
          <Text variant="titleMedium" style={styles.sectionTitle}>{t('settings.sectionAbout')}</Text>
          
          <List.Item
            title={t('settings.appVersion')}
            description="1.0.0"
            left={(props) => <List.Icon {...props} icon="information" />}
          />
          
          <List.Item
            title={t('settings.privacyPolicy.title')}
            description={t('settings.privacyPolicy.description')}
            left={(props) => <List.Icon {...props} icon="shield-account" />}
            onPress={() => {
              // TODO: Open privacy policy
            }}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
          />
          
          <List.Item
            title={t('settings.terms.title')}
            description={t('settings.terms.description')}
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
          >{t('settings.logout.title')}</Button>
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
          <Dialog.Title>{t('settings.biometric.confirmPassword')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={styles.dialogHint}>
              {t('settings.biometric.storeCredentials')}
            </Text>
            <TextInput
              label={t('settings.biometric.password')}
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
            >{t('common.cancel')}</Button>
            <Button
              onPress={() => {
                if (!passwordInput.trim()) {
                  Alert.alert(t('settings.biometric.passwordRequired'), t('settings.biometric.enterPassword'));
                  return;
                }
                void finalizeBiometricEnable(passwordInput.trim());
              }}
              loading={biometricBusy}
              disabled={biometricBusy}
            >{t('settings.biometric.enable')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <LanguagePickerDialog
        visible={languageDialogVisible}
        value={settings.language}
        onSelect={handleLanguageSelect}
        onDismiss={() => setLanguageDialogVisible(false)}
      />
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
