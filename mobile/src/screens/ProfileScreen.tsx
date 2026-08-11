import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  Surface,
  Title,
  Paragraph,
  Avatar,
  List,
  Chip,
  useTheme,
  ActivityIndicator,
} from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';

import Header from '../components/common/Header';
import { RootState, AppDispatch } from '../store';
import { setUser } from '../store/slices/authSlice';
import { userService } from '../services/userService';
import { MainStackScreenProps } from '../types/navigation';
import { User } from '../types';
import {
  formatDateLong,
  formatDateTime as sharedFormatDateTime,
} from '../utils/formatters';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'Profile'>;

function formatDate(value?: string | null): string {
  return (value && formatDateLong(value)) || 'Not available';
}

function formatDateTime(value?: string | null): string {
  return (value && sharedFormatDateTime(value)) || 'Not available';
}

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { user: storeUser } = useSelector((state: RootState) => state.auth);
  const [profile, setProfile] = useState<User | null>(storeUser);
  const [loading, setLoading] = useState(true);
  const [verificationBusy, setVerificationBusy] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await userService.getProfile();
      setProfile(fresh);
      dispatch(setUser(fresh));
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (storeUser) {
        setProfile(storeUser);
      }
      console.warn('Profile load failed:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [dispatch, storeUser]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const user = profile || storeUser;

  const handleEmailVerification = async () => {
    if (user?.isEmailVerified) {
      Alert.alert(t('profile.verifiedTitle'), t('profile.alreadyVerified'));
      return;
    }

    setVerificationBusy(true);
    try {
      const result = await userService.resendEmailVerification();
      let message =
        result.message ||
        t('profile.verificationSent');

      if (result.verificationToken) {
        message += `\n\nDevelopment token (for testing):\n${result.verificationToken}`;
      }

      Alert.alert(t('profile.verificationEmail'), message);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert(
        t('profile.verificationFailed'),
        err?.response?.data?.message ||
          err?.message ||
          t('profile.couldNotSendVerification')
      );
    } finally {
      setVerificationBusy(false);
    }
  };

  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleColor = (role: string): string => {
    switch (role) {
      case 'superadmin':
        return theme.colors.error;
      case 'admin':
        return theme.colors.primary;
      default:
        return theme.colors.tertiary;
    }
  };

  const accountActive = user?.isActive !== false;

  return (
    <View style={styles.container}>
      <Header
        title={t('profile.title')}
        subtitle={t('profile.subtitle')}
        showBack
        onBackPress={() => navigation.goBack()}
      />

      {loading && !user ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <Surface style={styles.profileHeader} elevation={2}>
            <Avatar.Text
              size={80}
              label={getInitials(user?.name || 'U')}
              style={[styles.avatar, { backgroundColor: theme.colors.primary }]}
            />
            <Title style={styles.userName}>{user?.name || 'Unknown User'}</Title>
            <Paragraph style={styles.userEmail}>{user?.email || 'No email'}</Paragraph>
            <View style={styles.roleContainer}>
              <Chip
                mode="outlined"
                style={[styles.roleChip, { borderColor: getRoleColor(user?.role || 'user') }]}
                textStyle={[styles.roleChipText, { color: getRoleColor(user?.role || 'user') }]}
              >
                {(user?.role || 'user').toUpperCase()}
              </Chip>
              <Chip
                mode="outlined"
                style={[
                  styles.statusChip,
                  { borderColor: accountActive ? theme.colors.primary : theme.colors.error },
                ]}
                textStyle={[
                  styles.statusChipText,
                  { color: accountActive ? theme.colors.primary : theme.colors.error },
                ]}
                icon={accountActive ? 'check-circle' : 'close-circle'}
              >
                {accountActive ? 'Active' : 'Inactive'}
              </Chip>
            </View>
          </Surface>

          <Surface style={styles.section} elevation={2}>
            <Title style={styles.sectionTitle}>{t('profile.accountInformation')}</Title>
            <List.Item
              title={t('profile.phone')}
              description={user?.phone || 'Not provided'}
              left={(props) => <List.Icon {...props} icon="phone" />}
            />
            <List.Item
              title={t('profile.accountStatus')}
              description={accountActive ? 'Your account is active on the server' : 'Account deactivated — contact support'}
              left={(props) => <List.Icon {...props} icon="account-check" />}
            />
            <List.Item
              title={t('profile.memberSince')}
              description={formatDate(user?.createdAt)}
              left={(props) => <List.Icon {...props} icon="calendar" />}
            />
            <List.Item
              title={t('profile.companies')}
              description={`Access to ${user?.companies?.length || 0} workspace(s)`}
              left={(props) => <List.Icon {...props} icon="office-building" />}
              onPress={() => navigation.navigate('CompanySelection')}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Surface>

          <Surface style={styles.section} elevation={2}>
            <Title style={styles.sectionTitle}>{t('settings.sectionSecurity')}</Title>
            <List.Item
              title={t('profile.emailVerification')}
              description={
                user?.isEmailVerified
                  ? 'Your email is verified'
                  : 'Tap to resend verification link'
              }
              left={(props) => <List.Icon {...props} icon="email-check" />}
              onPress={user?.isEmailVerified ? undefined : handleEmailVerification}
              disabled={verificationBusy || user?.isEmailVerified}
            />
            <List.Item
              title={t('profile.changePassword')}
              description={t('profile.changePasswordDescription')}
              left={(props) => <List.Icon {...props} icon="lock" />}
              onPress={() => navigation.navigate('ChangePassword')}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Surface>

          <Surface style={styles.section} elevation={2}>
            <Title style={styles.sectionTitle}>{t('profile.activity')}</Title>
            <List.Item
              title={t('profile.lastUpdated')}
              description={formatDateTime(user?.updatedAt)}
              left={(props) => <List.Icon {...props} icon="clock-outline" />}
            />
            <List.Item
              title={t('profile.lastSignIn')}
              description={formatDateTime(user?.lastLogin)}
              left={(props) => <List.Icon {...props} icon="login" />}
            />
            <List.Item
              title={t('profile.loginHistory')}
              description={t('profile.loginHistoryDescription')}
              left={(props) => <List.Icon {...props} icon="history" />}
              onPress={() => navigation.navigate('LoginHistory')}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
            />
          </Surface>

          <View style={styles.bottomSpacing} />
        </ScrollView>
      )}
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
  profileHeader: {
    padding: 24,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  avatar: {
    marginBottom: 12,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 16,
  },
  roleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  roleChip: {
    height: 28,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusChip: {
    height: 28,
  },
  statusChipText: {
    fontSize: 12,
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
  bottomSpacing: {
    height: 20,
  },
});

export default ProfileScreen;
