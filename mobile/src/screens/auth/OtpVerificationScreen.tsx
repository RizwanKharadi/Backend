/**
 * One screen for both OTP flows — signup verification and password reset.
 *
 * The only difference between them is where a successful code takes you:
 * verification yields a session and drops the user into the app, reset yields a
 * one-shot ticket and moves to the new-password screen. Everything else — the
 * input, the resend cooldown, the error handling — is identical, so it lives
 * here once.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

type Props = AuthStackScreenProps<'OtpVerification'>;

const CODE_LENGTH = 6;
/** Matches the server's resend cooldown; the server is still the authority. */
const RESEND_SECONDS = 60;

const OtpVerificationScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { email, purpose, name } = route.params;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    // Autofocus so the OS keyboard (and its OTP autofill suggestion) appears
    // without the user having to tap.
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== CODE_LENGTH || busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await authService.verifyOtp(email, value, purpose);

        if (purpose === 'password_reset') {
          navigation.replace('ResetPassword', {
            resetTicket: result.resetTicket || '',
            email,
          });
          return;
        }
        // Verification returns a session. AppNavigator watches auth state and
        // swaps to the main stack on its own, so there is nothing to navigate.
      } catch (e: unknown) {
        setError((e as Error).message);
        setCode('');
        inputRef.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [busy, email, navigation, purpose]
  );

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    // Submit as soon as the code is complete — nobody wants to type six digits
    // and then hunt for a button.
    if (digits.length === CODE_LENGTH) void submit(digits);
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await authService.resendOtp(email, purpose);
      setNotice(message);
      setSecondsLeft(RESEND_SECONDS);
      setCode('');
      inputRef.current?.focus();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');

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
                <Text style={styles.title}>{t('auth.otp.title')}</Text>
                <Text style={styles.subtitle}>
                  {t('auth.otp.sentTo', { email })}
                </Text>
              </View>
            </View>

            {/* A single hidden-ish input drives six visible boxes. One input
                means the OS can offer its SMS/email OTP autofill, which six
                separate fields break. */}
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
              style={styles.boxRow}
            >
              {boxes.map((digit, i) => (
                <View
                  key={i}
                  style={[
                    styles.box,
                    i === code.length && styles.boxActive,
                    !!error && styles.boxError,
                  ]}
                >
                  <Text style={styles.boxText}>{digit}</Text>
                </View>
              ))}
            </TouchableOpacity>

            <RNTextInput
              ref={inputRef}
              value={code}
              onChangeText={handleChange}
              keyboardType="number-pad"
              maxLength={CODE_LENGTH}
              style={styles.hiddenInput}
              // OS-level one-time-code autofill.
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              importantForAutofill="yes"
              editable={!busy}
              caretHidden
            />

            {busy ? (
              <ActivityIndicator style={styles.spinner} color={authColors.inputBorderFocus} />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {notice && !error ? <Text style={styles.notice}>{notice}</Text> : null}

            <View style={styles.resendRow}>
              {secondsLeft > 0 ? (
                <Text style={styles.resendWait}>
                  {t('auth.otp.resendIn', { seconds: secondsLeft })}
                </Text>
              ) : (
                <TouchableOpacity onPress={handleResend} disabled={busy}>
                  <Text style={styles.resendLink}>{t('auth.otp.resend')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
              <Text style={styles.backText}>{t('auth.otp.wrongEmail')}</Text>
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
  },
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
  boxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 24,
  },
  box: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: authColors.inputBorder,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: authColors.inputBorderFocus, backgroundColor: '#FFFFFF' },
  boxError: { borderColor: authColors.error },
  boxText: { fontSize: 24, fontWeight: '700', color: authColors.textPrimary },
  // Kept on-screen but invisible: a display:none input cannot receive autofill.
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
  spinner: { marginTop: 16 },
  error: {
    marginTop: 16,
    fontSize: 13,
    color: authColors.error,
    textAlign: 'center',
  },
  notice: {
    marginTop: 16,
    fontSize: 13,
    color: authColors.textSecondary,
    textAlign: 'center',
  },
  resendRow: { marginTop: 20, alignItems: 'center' },
  resendWait: { fontSize: 13, color: authColors.textSecondary },
  resendLink: { fontSize: 14, fontWeight: '700', color: authColors.inputBorderFocus },
  backRow: { marginTop: 18, alignItems: 'center' },
  backText: { fontSize: 13, color: authColors.textSecondary },
});

export default OtpVerificationScreen;
