/**
 * Step 3 of password reset: set the new password using the one-shot ticket
 * returned when the OTP was verified.
 *
 * The ticket is short-lived and purpose-scoped, so this screen holds no secret
 * worth stealing and the code itself is already spent by the time we get here.
 */
import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput as RNTextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import AuthBackground from '../../components/auth/AuthBackground';
import { FinnyMascot } from '../../components/mascot';
import { authColors } from '../../theme/authTheme';
import { authService } from '../../services';
import { AuthStackScreenProps } from '../../types/navigation';
import { useTranslation } from 'react-i18next';

type Props = AuthStackScreenProps<'ResetPassword'>;

const MIN_LENGTH = 6;

const ResetPasswordScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { resetTicket } = route.params;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (password.length < MIN_LENGTH) {
      setError(t('auth.field.passwordMin'));
      return;
    }
    if (password !== confirm) {
      setError(t('password.mismatch'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Succeeding here signs the user in, so AppNavigator swaps to the main
      // stack on its own — there is nothing to navigate to.
      await authService.resetPassword(resetTicket, password);
    } catch (e: unknown) {
      setError((e as Error).message);
      setBusy(false);
    }
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
            styles.scroll,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.mascotRow}>
              <FinnyMascot pose="help" size="sm" animation="float" decorative />
              <View style={styles.headings}>
                <Text style={styles.title}>{t('auth.reset.title')}</Text>
                <Text style={styles.subtitle}>{t('auth.reset.subtitle')}</Text>
              </View>
            </View>

            <Text style={styles.label}>{t('password.new')}</Text>
            <View style={[styles.inputWrap, !!error && styles.inputError]}>
              <RNTextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setError(null);
                }}
                style={styles.input}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoComplete="password-new"
                textContentType="newPassword"
                editable={!busy}
                placeholder="••••••"
                placeholderTextColor={authColors.textSecondary}
              />
              <TouchableOpacity onPress={() => setShow((s) => !s)} hitSlop={10}>
                <Icon
                  name={show ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={authColors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>{t('password.confirmNew')}</Text>
            <View style={[styles.inputWrap, !!error && styles.inputError]}>
              <RNTextInput
                value={confirm}
                onChangeText={(v) => {
                  setConfirm(v);
                  setError(null);
                }}
                style={styles.input}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoComplete="password-new"
                textContentType="newPassword"
                editable={!busy}
                placeholder="••••••"
                placeholderTextColor={authColors.textSecondary}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('password.update')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={styles.backRow}
            >
              <Text style={styles.backText}>{t('auth.backToLogin')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: authColors.bgDeep },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headings: { flex: 1 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: authColors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: authColors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  label: {
    marginTop: 20,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '600',
    color: authColors.textSecondary,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: authColors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAFC',
  },
  inputError: { borderColor: authColors.error },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    color: authColors.textPrimary,
  },
  error: { marginTop: 10, fontSize: 13, color: authColors.error },
  primaryBtn: {
    marginTop: 22,
    height: 50,
    borderRadius: 14,
    backgroundColor: authColors.inputBorderFocus,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  backRow: { marginTop: 18, alignItems: 'center' },
  backText: { fontSize: 13, color: authColors.textSecondary },
});

export default ResetPasswordScreen;
