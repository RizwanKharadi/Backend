import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import {
  Surface,
  TextInput,
  Button,
  Text,
  ActivityIndicator,
} from 'react-native-paper';
import { useSelector } from 'react-redux';

import Header from '../components/common/Header';
import { RootState } from '../store';
import { userService } from '../services/userService';
import { MainStackScreenProps } from '../types/navigation';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'ChangePassword'>;

const ChangePasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { user } = useSelector((state: RootState) => state.auth);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!user?.id) {
      Alert.alert(t('common.error'), t('password.mustSignIn'));
      return;
    }
    if (!currentPassword || !newPassword) {
      Alert.alert(t('password.requiredTitle'), t('password.enterBoth'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('password.weakTitle'), t('password.tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('password.mismatchTitle'), t('password.mismatch'));
      return;
    }

    setLoading(true);
    try {
      const result = await userService.changePassword(
        user.id,
        currentPassword,
        newPassword
      );
      Alert.alert(t('common.success'), result.message || t('password.changed'), [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert(
        t('password.failedTitle'),
        error?.response?.data?.message ||
          error?.message ||
          t('password.couldNotChange')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header
        title={t('profile.changePassword')}
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        <Surface style={styles.card} elevation={2}>
          <Text variant="bodyMedium" style={styles.hint}>
            Enter your current password, then choose a new one (minimum 6 characters).
          </Text>

          <TextInput
            label={t('password.current')}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry={!showCurrent}
            autoCapitalize="none"
            mode="outlined"
            style={styles.input}
            right={
              <TextInput.Icon
                icon={showCurrent ? 'eye-off' : 'eye'}
                onPress={() => setShowCurrent((v) => !v)}
              />
            }
          />
          <TextInput
            label={t('password.new')}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNew}
            autoCapitalize="none"
            mode="outlined"
            style={styles.input}
            right={
              <TextInput.Icon
                icon={showNew ? 'eye-off' : 'eye'}
                onPress={() => setShowNew((v) => !v)}
              />
            }
          />
          <TextInput
            label={t('password.confirmNew')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showNew}
            autoCapitalize="none"
            mode="outlined"
            style={styles.input}
          />

          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            style={styles.btn}
          >{t('password.update')}</Button>
          {loading ? <ActivityIndicator style={styles.spinner} /> : null}
        </Surface>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16 },
  card: { padding: 16, borderRadius: 12 },
  hint: { marginBottom: 16, color: '#555' },
  input: { marginBottom: 12 },
  btn: { marginTop: 8 },
  spinner: { marginTop: 12 },
});

export default ChangePasswordScreen;
