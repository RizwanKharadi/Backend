import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  TextInput as RNTextInput,
  ActivityIndicator,
  StatusBar,
  Image,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useDispatch, useSelector } from 'react-redux';
import { useForm, Controller } from 'react-hook-form';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import AuthBackground from '../../components/auth/AuthBackground';
import { authColors, authSpacing } from '../../theme/authTheme';
import { AppDispatch, RootState } from '../../store';
import { login, biometricLogin, clearError } from '../../store/slices/authSlice';
import { authService, biometricService } from '../../services';
import { AuthStackScreenProps } from '../../types/navigation';
import { LoginCredentials } from '../../types';
import {
  fetchCompanies,
  setSelectedCompany,
} from '../../store/slices/companySlice';
import { setSelectedCompany as setPersistedCompanyId } from '../../store/slices/settingsSlice';
import { initializeRealtimeServices } from '../../services';
import { pickDefaultCompany } from '../../utils/companySelection';
import { useTranslation } from 'react-i18next';
import { FinnyMascot } from '../../components/mascot';

type Props = AuthStackScreenProps<'Login'>;

interface LoginForm {
  email: string;
  password: string;
  rememberMe: boolean;
}

const FEATURES = [
  { icon: 'sync', label: 'Tally sync' },
  { icon: 'chart-timeline-variant', label: 'Live reports' },
  { icon: 'shield-check', label: 'Secure' },
] as const;

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch<AppDispatch>();
  const { isLoading, error } = useSelector((state: RootState) => state.auth);
  const biometricEnabled = useSelector((state: RootState) => state.settings.biometricEnabled);

  const [showPassword, setShowPassword] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  });

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const checkBiometricAvailability = React.useCallback(async () => {
    const canLogin = await authService.canUseBiometricLogin();
    const enabledInSettings =
      biometricEnabled || (await biometricService.isBiometricEnabled());
    setBiometricAvailable(canLogin && enabledInSettings);
  }, [biometricEnabled]);

  useFocusEffect(
    React.useCallback(() => {
      void checkBiometricAvailability();
      void authService.getStoredBiometricEmail().then((email) => {
        if (email) setValue('email', email);
      });
    }, [checkBiometricAvailability, setValue])
  );

  const onSubmit = async (data: LoginForm) => {
    try {
      const credentials: LoginCredentials = {
        email: data.email.toLowerCase().trim(),
        password: data.password,
        rememberMe: data.rememberMe,
      };

      await dispatch(login(credentials)).unwrap();

      const companiesResult = await dispatch(fetchCompanies({})).unwrap();

      if (companiesResult && companiesResult.length > 0) {
        const chosen = pickDefaultCompany(companiesResult as any[]);
        if (chosen) {
          const id = String(chosen._id || chosen.id);
          dispatch(setSelectedCompany({ ...chosen, id }));
          dispatch(setPersistedCompanyId(id));
          await initializeRealtimeServices();
        }
      }
    } catch (err: any) {
      // Correct password, unverified address — send them to the OTP screen
      // rather than telling them their credentials are wrong.
      if (err?.requiresVerification) {
        navigation.navigate('OtpVerification', {
          email: err.email || data.email.toLowerCase().trim(),
          purpose: 'email_verification',
        });
        return;
      }
      Alert.alert(
        t('auth.login.failed'),
        err?.message || err || t('auth.login.checkCredentials')
      );
    }
  };

  const handleBiometricLogin = async () => {
    try {
      await dispatch(biometricLogin()).unwrap();
      const companiesResult = await dispatch(fetchCompanies({})).unwrap();
      if (companiesResult?.length) {
        const chosen = pickDefaultCompany(companiesResult as any[]);
        if (chosen) {
          const id = String(chosen._id || chosen.id);
          dispatch(setSelectedCompany({ ...chosen, id }));
          dispatch(setPersistedCompanyId(id));
          await initializeRealtimeServices();
        }
      }
    } catch (err: any) {
      Alert.alert(
        t('auth.login.biometricFailed'),
        err || 'Please try again or use password login.'
      );
    }
  };

  const inputBorder = (focused: boolean, hasError: boolean) => {
    if (hasError) return authColors.error;
    if (focused) return authColors.inputBorderFocus;
    return authColors.inputBorder;
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={authColors.bgDeep} />
      <AuthBackground />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.logoRing}>
              <Image
                source={require('../../assets/tallyfin-icon.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brand}>{t('common.appName')}</Text>
            <Text style={styles.tagline}>{t('common.tagline')}</Text>

            <View style={styles.featureRow}>
              {FEATURES.map((f) => (
                <View key={f.label} style={styles.featureChip}>
                  <Icon name={f.icon} size={14} color={authColors.textOnDark} />
                  <Text style={styles.featureChipText}>{f.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Small welcoming Finny — beside the heading, deliberately not
                large enough to compete with the sign-in form. */}
            <View style={styles.welcomeRow}>
              <FinnyMascot pose="welcome" size="sm" animation="wave" decorative />
              <View style={styles.welcomeText}>
                <Text style={styles.cardTitle}>{t('auth.login.welcomeBack')}</Text>
                <Text style={styles.cardSubtitle}>{t('auth.login.subtitle')}</Text>
              </View>
            </View>

            <Controller
              control={control}
              name="email"
              rules={{
                required: t('auth.field.emailRequired'),
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: t('auth.field.emailInvalid'),
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>{t('auth.field.email')}</Text>
                  <View
                    style={[
                      styles.inputRow,
                      {
                        borderColor: inputBorder(emailFocused, !!errors.email),
                        backgroundColor: emailFocused ? '#fff' : authColors.inputBg,
                      },
                    ]}
                  >
                    <Icon
                      name="email-outline"
                      size={22}
                      color={emailFocused ? authColors.primary : authColors.textSecondary}
                      style={styles.inputIcon}
                    />
                    <RNTextInput
                      value={value}
                      onChangeText={onChange}
                      onBlur={() => {
                        onBlur();
                        setEmailFocused(false);
                      }}
                      onFocus={() => setEmailFocused(true)}
                      placeholder="you@company.com"
                      placeholderTextColor="#94a3b8"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      style={styles.textInput}
                    />
                  </View>
                  {errors.email ? (
                    <Text style={styles.fieldError}>{errors.email.message}</Text>
                  ) : null}
                </View>
              )}
            />

            <Controller
              control={control}
              name="password"
              rules={{
                required: t('auth.field.passwordRequired'),
                minLength: {
                  value: 6,
                  message: t('auth.field.passwordMin'),
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>{t('auth.field.password')}</Text>
                  <View
                    style={[
                      styles.inputRow,
                      {
                        borderColor: inputBorder(passwordFocused, !!errors.password),
                        backgroundColor: passwordFocused ? '#fff' : authColors.inputBg,
                      },
                    ]}
                  >
                    <Icon
                      name="lock-outline"
                      size={22}
                      color={passwordFocused ? authColors.primary : authColors.textSecondary}
                      style={styles.inputIcon}
                    />
                    <RNTextInput
                      value={value}
                      onChangeText={onChange}
                      onBlur={() => {
                        onBlur();
                        setPasswordFocused(false);
                      }}
                      onFocus={() => setPasswordFocused(true)}
                      placeholder="••••••••"
                      placeholderTextColor="#94a3b8"
                      secureTextEntry={!showPassword}
                      autoComplete="password"
                      style={styles.textInput}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Icon
                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={22}
                        color={authColors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                  {errors.password ? (
                    <Text style={styles.fieldError}>{errors.password.message}</Text>
                  ) : null}
                </View>
              )}
            />

            <View style={styles.rememberRow}>
              <Controller
                control={control}
                name="rememberMe"
                render={({ field: { onChange, value } }) => (
                  <TouchableOpacity
                    style={styles.rememberTouch}
                    onPress={() => onChange(!value)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, value && styles.checkboxChecked]}>
                      {value ? <Icon name="check" size={14} color="#fff" /> : null}
                    </View>
                    <Text style={styles.rememberText}>{t('auth.login.rememberMe')}</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity
                onPress={() => navigation.navigate('ForgotPassword')}
                disabled={isLoading}
              >
                <Text style={styles.forgotLink}>{t('auth.login.forgotPassword')}</Text>
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <Icon name="alert-circle-outline" size={18} color={authColors.error} />
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, isLoading && styles.primaryBtnDisabled]}
              onPress={handleSubmit(onSubmit)}
              disabled={isLoading}
              activeOpacity={0.88}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>{t('auth.login.signIn')}</Text>
                  <Icon name="arrow-right" size={22} color="#fff" />
                </>
              )}
            </TouchableOpacity>

            {biometricAvailable ? (
              <TouchableOpacity
                style={styles.biometricBtn}
                onPress={handleBiometricLogin}
                disabled={isLoading}
                activeOpacity={0.85}
              >
                <View style={styles.biometricIconWrap}>
                  <Icon name="fingerprint" size={28} color={authColors.primary} />
                </View>
                <Text style={styles.biometricText}>{t('auth.login.signInBiometric')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerHint}>{t('auth.login.signUpHint')}</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Register')}
              disabled={isLoading}
              style={styles.signUpRow}
              activeOpacity={0.7}
            >
              <Text style={styles.footerHint}>{t('auth.login.noAccount')} </Text>
              <Text style={styles.signUpLink}>{t('auth.register.signUp')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authColors.bgDeep,
  },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: authSpacing.screenPadding,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoRing: {
    width: 96,
    height: 96,
    borderRadius: 20,
    padding: 4,
    backgroundColor: '#ffffff',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: authColors.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  logoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    color: authColors.textOnDark,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: authColors.textOnDarkMuted,
    marginTop: 6,
    fontWeight: '500',
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: authColors.chipBg,
    borderWidth: 1,
    borderColor: authColors.chipBorder,
  },
  featureChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: authColors.textOnDark,
  },
  card: {
    backgroundColor: authColors.card,
    borderRadius: authSpacing.cardRadius,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: { elevation: 10 },
    }),
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  welcomeText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: authColors.textPrimary,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 14,
    color: authColors.textSecondary,
    marginTop: 4,
    marginBottom: 22,
  },
  fieldWrap: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: authColors.textSecondary,
    marginBottom: 8,
    marginLeft: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: authSpacing.inputRadius,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: authColors.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  fieldError: {
    fontSize: 12,
    color: authColors.error,
    marginTop: 6,
    marginLeft: 2,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  rememberTouch: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: authColors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: authColors.primary,
    borderColor: authColors.primary,
  },
  rememberText: {
    fontSize: 14,
    color: authColors.textSecondary,
    fontWeight: '500',
  },
  forgotLink: {
    fontSize: 14,
    fontWeight: '600',
    color: authColors.primary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: authColors.error,
    fontWeight: '500',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authColors.primary,
    borderRadius: authSpacing.buttonRadius,
    minHeight: 54,
    ...Platform.select({
      ios: {
        shadowColor: authColors.primaryDark,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  primaryBtnDisabled: {
    opacity: 0.85,
  },
  primaryBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 12,
    gap: 12,
  },
  biometricIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  biometricText: {
    fontSize: 15,
    fontWeight: '600',
    color: authColors.primary,
  },
  footer: {
    marginTop: 28,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 12,
  },
  footerHint: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: authColors.textOnDarkMuted,
  },
  signUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  signUpLink: {
    fontSize: 14,
    fontWeight: '700',
    color: authColors.primary,
  },
});

export default LoginScreen;
