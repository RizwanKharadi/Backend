import React, { useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import {
  TextInput,
  Button,
  Text,
  Surface,
  useTheme,
  HelperText,
} from 'react-native-paper';
import { useDispatch, useSelector } from 'react-redux';
import { useForm, Controller } from 'react-hook-form';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppDispatch, RootState } from '../../store';
import { register, clearError } from '../../store/slices/authSlice';
import {
  fetchCompanies,
  setSelectedCompany,
} from '../../store/slices/companySlice';
import { setSelectedCompany as setPersistedCompanyId } from '../../store/slices/settingsSlice';
import { initializeRealtimeServices } from '../../services';
import { AuthStackScreenProps } from '../../types/navigation';
import { RegisterData } from '../../types';
import { pickDefaultCompany } from '../../utils/companySelection';
import { useTranslation } from 'react-i18next';

type Props = AuthStackScreenProps<'Register'>;

interface RegisterForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { isLoading, error } = useSelector((state: RootState) => state.auth);

  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterForm>({
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
    },
  });

  const passwordValue = watch('password');

  useEffect(() => {
    dispatch(clearError());
  }, [dispatch]);

  const onSubmit = async (data: RegisterForm) => {
    try {
      const payload: RegisterData = {
        name: data.name.trim(),
        email: data.email.toLowerCase().trim(),
        phone: data.phone.trim(),
        password: data.password,
      };

      const result = await dispatch(register(payload)).unwrap();

      // Registration no longer signs the user in — the account is unusable
      // until the emailed code is confirmed. Company selection happens after
      // verification, once there is a session to make requests with.
      if (result?.requiresVerification) {
        navigation.navigate('OtpVerification', {
          email: result.email || payload.email,
          purpose: 'email_verification',
          name: payload.name,
        });
        return;
      }

      const companiesResult = await dispatch(fetchCompanies({})).unwrap();

      if (companiesResult && companiesResult.length > 0) {
        const chosen = pickDefaultCompany(companiesResult as any[]);
        if (chosen) {
          const id = String(chosen._id || chosen.id);
          dispatch(
            setSelectedCompany({
              ...chosen,
              id,
            })
          );
          dispatch(setPersistedCompanyId(id));
          await initializeRealtimeServices();
        }
      }
    } catch (err: any) {
      Alert.alert(
        t('auth.register.failed'),
        err || t('auth.register.checkDetails')
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Icon name="account-plus" size={72} color={theme.colors.primary} />
          <Text variant="headlineMedium" style={styles.title}>
            {t('auth.register.title')}
          </Text>
          <Text variant="bodyLarge" style={styles.subtitle}>
            {t('auth.register.subtitle')}
          </Text>
        </View>

        <Surface style={styles.formContainer} elevation={2}>
          <View style={styles.form}>
            <Controller
              control={control}
              name="name"
              rules={{
                required: t('auth.field.nameRequired'),
                minLength: {
                  value: 2,
                  message: t('auth.field.nameMin'),
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  label={t('auth.field.fullName')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  mode="outlined"
                  autoCapitalize="words"
                  error={!!errors.name}
                  left={<TextInput.Icon icon="account" />}
                  style={styles.input}
                />
              )}
            />
            {errors.name && (
              <HelperText type="error" visible={!!errors.name}>
                {errors.name.message}
              </HelperText>
            )}

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
                <TextInput
                  label={t('auth.field.email')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  mode="outlined"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  error={!!errors.email}
                  left={<TextInput.Icon icon="email" />}
                  style={styles.input}
                />
              )}
            />
            {errors.email && (
              <HelperText type="error" visible={!!errors.email}>
                {errors.email.message}
              </HelperText>
            )}

            <Controller
              control={control}
              name="phone"
              rules={{
                required: t('auth.field.phoneRequired'),
                minLength: {
                  value: 8,
                  message: t('auth.field.phoneInvalid'),
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  label={t('auth.field.phone')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  mode="outlined"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  error={!!errors.phone}
                  left={<TextInput.Icon icon="phone" />}
                  style={styles.input}
                />
              )}
            />
            {errors.phone && (
              <HelperText type="error" visible={!!errors.phone}>
                {errors.phone.message}
              </HelperText>
            )}

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
                <TextInput
                  label={t('auth.field.password')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  mode="outlined"
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                  error={!!errors.password}
                  left={<TextInput.Icon icon="lock" />}
                  right={
                    <TextInput.Icon
                      icon={showPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowPassword(!showPassword)}
                    />
                  }
                  style={styles.input}
                />
              )}
            />
            {errors.password && (
              <HelperText type="error" visible={!!errors.password}>
                {errors.password.message}
              </HelperText>
            )}

            <Controller
              control={control}
              name="confirmPassword"
              rules={{
                required: t('auth.field.confirmRequired'),
                validate: (value) =>
                  value === passwordValue || 'Passwords do not match',
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  label={t('auth.field.confirmPassword')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  mode="outlined"
                  secureTextEntry={!showConfirm}
                  autoComplete="password-new"
                  error={!!errors.confirmPassword}
                  left={<TextInput.Icon icon="lock-check" />}
                  right={
                    <TextInput.Icon
                      icon={showConfirm ? 'eye-off' : 'eye'}
                      onPress={() => setShowConfirm(!showConfirm)}
                    />
                  }
                  style={styles.input}
                />
              )}
            />
            {errors.confirmPassword && (
              <HelperText type="error" visible={!!errors.confirmPassword}>
                {errors.confirmPassword.message}
              </HelperText>
            )}

            {error && (
              <HelperText type="error" visible={!!error} style={styles.errorText}>
                {error}
              </HelperText>
            )}

            <Button
              mode="contained"
              onPress={handleSubmit(onSubmit)}
              loading={isLoading}
              disabled={isLoading}
              style={styles.primaryButton}
              contentStyle={styles.buttonContent}
            >{t('auth.register.title')}</Button>
          </View>
        </Surface>

        <View style={styles.footer}>
          <Text variant="bodyMedium" style={styles.footerText}>
            {t('auth.register.haveAccount')}{' '}
          </Text>
          <Button
            mode="text"
            onPress={() => navigation.navigate('Login')}
            disabled={isLoading}
            compact
          >
            {t('auth.login.signIn')}
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.72,
    lineHeight: 20,
  },
  formContainer: {
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: 'transparent',
  },
  errorText: {
    textAlign: 'center',
    marginTop: -4,
  },
  primaryButton: {
    marginTop: 8,
  },
  buttonContent: {
    height: 48,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
  },
});

export default RegisterScreen;
