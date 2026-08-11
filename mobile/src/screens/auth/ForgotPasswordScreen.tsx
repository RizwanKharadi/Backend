/**
 * Step 1 of password reset: collect the address and ask the server to send a
 * code.
 *
 * The server answers identically whether or not the address has an account, so
 * this screen must too — showing "no such user" here would hand an attacker a
 * list of who banks with TallyFin.
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

import AuthBackground from '../../components/auth/AuthBackground';
import { FinnyMascot } from '../../components/mascot';
import { authColors } from '../../theme/authTheme';
import { authService } from '../../services';
import { AuthStackScreenProps } from '../../types/navigation';
import { useTranslation } from 'react-i18next';

type Props = AuthStackScreenProps<'ForgotPassword'>;

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) {
      setError(t('auth.field.emailInvalid'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await authService.forgotPassword(addr);
      // Always advance, regardless of whether an account exists. The OTP screen
      // will simply never accept a code for an address with no account.
      navigation.navigate('OtpVerification', {
        email: addr,
        purpose: 'password_reset',
      });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
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
              <FinnyMascot pose="thinking" size="sm" animation="float" decorative />
              <View style={styles.headings}>
                <Text style={styles.title}>{t('auth.forgot.title')}</Text>
                <Text style={styles.subtitle}>{t('auth.forgot.subtitle')}</Text>
              </View>
            </View>

            <Text style={styles.label}>{t('auth.field.email')}</Text>
            <RNTextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              style={[styles.input, !!error && styles.inputError]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              placeholder="you@company.com"
              placeholderTextColor={authColors.textSecondary}
              editable={!busy}
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
            />

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
                <Text style={styles.primaryBtnText}>{t('auth.forgot.sendCode')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
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
    marginTop: 24,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '600',
    color: authColors.textSecondary,
  },
  input: {
    borderWidth: 1.5,
    borderColor: authColors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    color: authColors.textPrimary,
    backgroundColor: '#F8FAFC',
  },
  inputError: { borderColor: authColors.error },
  error: { marginTop: 10, fontSize: 13, color: authColors.error },
  primaryBtn: {
    marginTop: 20,
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

export default ForgotPasswordScreen;
