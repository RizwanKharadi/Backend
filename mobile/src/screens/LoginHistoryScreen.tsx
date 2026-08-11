import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Surface, ActivityIndicator, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Header from '../components/common/Header';
import { userService } from '../services/userService';
import { MainStackScreenProps } from '../types/navigation';
import { User } from '../types';
import { formatDateTime as sharedFormatDateTime } from '../utils/formatters';
import { dashboardColors } from '../components/dashboard/dashboardTheme';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'LoginHistory'>;

function formatDateTime(value?: string | null): string {
  return (value && sharedFormatDateTime(value)) || '—';
}

const LoginHistoryScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const profile = await userService.getProfile();
        setUser(profile);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const entries = [
    {
      id: 'last',
      title: 'Last sign-in',
      when: formatDateTime(user?.lastLogin),
      icon: 'login',
      detail: 'Most recent successful login to FinSync360',
    },
    {
      id: 'member',
      title: 'Account created',
      when: formatDateTime(user?.createdAt),
      icon: 'account-plus',
      detail: 'When you registered (same as desktop agent account)',
    },
    {
      id: 'updated',
      title: 'Profile last updated',
      when: formatDateTime(user?.updatedAt),
      icon: 'update',
      detail: 'Last change to your profile on the server',
    },
  ];

  return (
    <View style={styles.container}>
      <Header
        title={t('profile.loginHistory')}
        subtitle={t('profile.accountActivity')}
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : (
          <>
            <Surface style={styles.summary} elevation={2}>
              <Icon name="shield-account" size={28} color={dashboardColors.accent} />
              <Text style={styles.summaryTitle}>{user?.email || '—'}</Text>
              <Text style={styles.summaryMeta}>
                Account status: {user?.isActive !== false ? 'Active' : 'Inactive'}
              </Text>
            </Surface>

            {entries.map((entry, index) => (
              <Surface key={entry.id} style={styles.row} elevation={1}>
                <View style={styles.rowIcon}>
                  <Icon name={entry.icon} size={22} color={dashboardColors.accent} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{entry.title}</Text>
                  <Text style={styles.rowWhen}>{entry.when}</Text>
                  <Text style={styles.rowDetail}>{entry.detail}</Text>
                </View>
                {index < entries.length - 1 ? null : null}
              </Surface>
            ))}

            <Divider style={styles.divider} />
            <Text style={styles.footnote}>
              Detailed per-device login audit logs will be added in a future release. This screen
              shows data stored on your FinSync360 account.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },
  summary: {
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', marginTop: 10, color: '#0f172a' },
  summaryMeta: { fontSize: 13, color: dashboardColors.muted, marginTop: 4 },
  row: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  rowWhen: { fontSize: 14, fontWeight: '600', color: dashboardColors.accent, marginTop: 4 },
  rowDetail: { fontSize: 12, color: dashboardColors.muted, marginTop: 4, lineHeight: 17 },
  divider: { marginVertical: 16 },
  footnote: { fontSize: 12, color: '#94a3b8', lineHeight: 18, textAlign: 'center' },
});

export default LoginHistoryScreen;
