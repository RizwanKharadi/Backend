import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  FAB,
  Chip,
  List,
  TextInput,
  Switch,
  ActivityIndicator,
  Text,
  ProgressBar,
  Divider,
} from 'react-native-paper';
import { useAppDispatch, useTally, useCompany } from '../store/hooks';
import {
  fetchTallyConnections,
  testTallyConnection,
  fetchSyncStatus,
  performFullSync,
  fetchSyncLogs,
  fetchSyncConflicts,
  fetchTallySettings,
  updateTallySettings,
  fetchSyncStatistics,
} from '../store/slices/tallySlice';
import { formatDate, formatDateTime } from '../utils/formatters';
import { useTranslation } from 'react-i18next';

const TallyIntegrationScreen: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { 
    connections, 
    syncStatus, 
    syncLogs, 
    syncConflicts, 
    settings, 
    statistics,
    isLoading, 
    isSyncing, 
    error 
  } = useTally();
  const { selectedCompany } = useCompany();
  
  const [activeTab, setActiveTab] = useState<'status' | 'settings' | 'logs' | 'conflicts'>('status');
  const [refreshing, setRefreshing] = useState(false);
  const [connectionForm, setConnectionForm] = useState({
    host: 'localhost',
    port: '9000',
  });

  useEffect(() => {
    if (selectedCompany) {
      loadTallyData();
    }
  }, [selectedCompany]);

  const loadTallyData = async () => {
    if (!selectedCompany) return;

    try {
      await Promise.all([
        dispatch(fetchTallyConnections(selectedCompany.id)),
        dispatch(fetchSyncStatus(selectedCompany.id)),
        dispatch(fetchSyncLogs({ companyId: selectedCompany.id })),
        dispatch(fetchSyncConflicts({ companyId: selectedCompany.id })),
        dispatch(fetchTallySettings(selectedCompany.id)),
        dispatch(fetchSyncStatistics({ companyId: selectedCompany.id })),
      ]);
    } catch (error) {
      console.error('Error loading Tally data:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTallyData();
    setRefreshing(false);
  };

  const handleTestConnection = async () => {
    if (!selectedCompany) return;

    try {
      const result = await dispatch(testTallyConnection({
        host: connectionForm.host,
        port: parseInt(connectionForm.port),
        companyId: selectedCompany.id,
      }));

      if (result.payload.connected) {
        Alert.alert(t('common.success'), t('tally.connectSuccess'));
      } else {
        Alert.alert(t('common.error'), result.payload.message || t('tally.connectFailed'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('tally.testFailed'));
    }
  };

  const handleFullSync = async () => {
    if (!selectedCompany) return;

    Alert.alert(
      t('tally.fullSync.title'),
      t('tally.fullSync.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tally.fullSync.confirm'),
          onPress: async () => {
            try {
              await dispatch(performFullSync({
                companyId: selectedCompany.id,
                options: {
                  direction: 'bidirectional',
                  entities: ['vouchers', 'items', 'parties'],
                },
              }));
              Alert.alert(t('common.success'), t('tally.fullSync.started'));
              loadTallyData();
            } catch (error) {
              Alert.alert(t('common.error'), t('tally.fullSync.failed'));
            }
          },
        },
      ]
    );
  };

  const handleSettingsUpdate = async (newSettings: any) => {
    if (!selectedCompany) return;

    try {
      await dispatch(updateTallySettings({
        companyId: selectedCompany.id,
        settings: newSettings,
      }));
      Alert.alert(t('common.success'), t('tally.settingsUpdated'));
    } catch (error) {
      Alert.alert(t('common.error'), t('tally.settingsFailed'));
    }
  };

  const getSyncStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#4CAF50';
      case 'syncing':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#9E9E9E';
    }
  };

  const renderStatusTab = () => (
    <ScrollView style={styles.tabContent}>
      {/* Connection Status */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>{t('tally.connectionStatus')}</Title>
          {connections.length > 0 ? (
            connections.map((connection) => (
              <List.Item
                key={connection.id}
                title={connection.name}
                description={`${connection.host}:${connection.port}`}
                left={(props) => (
                  <List.Icon 
                    {...props} 
                    icon={connection.isActive ? "check-circle" : "alert-circle"}
                    color={connection.isActive ? "#4CAF50" : "#F44336"}
                  />
                )}
                right={(props) => (
                  <Chip mode="outlined">
                    {connection.isActive ? t('tally.active') : t('tally.inactive')}
                  </Chip>
                )}
              />
            ))
          ) : (
            <Paragraph>{t('tally.noConnections')}</Paragraph>
          )}
        </Card.Content>
      </Card>

      {/* Sync Status */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>{t('tally.syncStatus')}</Title>
          {syncStatus ? (
            <>
              <View style={styles.statusRow}>
                <Text>{t('tally.statusLabel')}</Text>
                <Chip 
                  mode="outlined"
                  textStyle={{ color: getSyncStatusColor(syncStatus.status) }}
                >
                  {syncStatus.status}
                </Chip>
              </View>
              
              {syncStatus.lastSyncTime && (
                <View style={styles.statusRow}>
                  <Text>{t('tally.lastSyncLabel')}</Text>
                  <Text>{formatDateTime(syncStatus.lastSyncTime)}</Text>
                </View>
              )}

              {syncStatus.progress && (
                <View style={styles.progressContainer}>
                  <Text>
                    {t('tally.progress', {
                      current: syncStatus.progress.current,
                      total: syncStatus.progress.total,
                    })}
                  </Text>
                  <ProgressBar 
                    progress={syncStatus.progress.current / syncStatus.progress.total}
                    style={styles.progressBar}
                  />
                  <Text style={styles.progressStage}>{syncStatus.progress.stage}</Text>
                </View>
              )}

              {syncStatus.stats && (
                <View style={styles.statsContainer}>
                  <Title style={styles.statsTitle}>{t('tally.syncStatistics')}</Title>
                  <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>{t('tally.entity.vouchers')}</Text>
                      <Text style={styles.statValue}>
                        {syncStatus.stats.vouchers.synced}/{syncStatus.stats.vouchers.synced + syncStatus.stats.vouchers.failed}
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>{t('tally.entity.items')}</Text>
                      <Text style={styles.statValue}>
                        {syncStatus.stats.items.synced}/{syncStatus.stats.items.synced + syncStatus.stats.items.failed}
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={styles.statLabel}>{t('tally.entity.parties')}</Text>
                      <Text style={styles.statValue}>
                        {syncStatus.stats.parties.synced}/{syncStatus.stats.parties.synced + syncStatus.stats.parties.failed}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </>
          ) : (
            <Paragraph>{t('tally.noSyncStatus')}</Paragraph>
          )}
        </Card.Content>
      </Card>

      {/* Test Connection */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>{t('tally.testConnection')}</Title>
          <TextInput
            label={t('tally.host')}
            value={connectionForm.host}
            onChangeText={(text) => setConnectionForm({ ...connectionForm, host: text })}
            style={styles.input}
          />
          <TextInput
            label={t('tally.port')}
            value={connectionForm.port}
            onChangeText={(text) => setConnectionForm({ ...connectionForm, port: text })}
            keyboardType="numeric"
            style={styles.input}
          />
          <Button
            mode="contained"
            onPress={handleTestConnection}
            style={styles.testButton}
          >
            {t('tally.testConnection')}
          </Button>
        </Card.Content>
      </Card>
    </ScrollView>
  );

  const renderSettingsTab = () => (
    <ScrollView style={styles.tabContent}>
      {settings && (
        <Card style={styles.card}>
          <Card.Content>
            <Title>{t('sync.settings')}</Title>
            
            <View style={styles.settingRow}>
              <Text>{t('settings.autoSync.title')}</Text>
              <Switch
                value={settings.autoSync}
                onValueChange={(value) => 
                  handleSettingsUpdate({ ...settings, autoSync: value })
                }
              />
            </View>

            <View style={styles.settingRow}>
              <Text>{t('tally.syncIntervalMinutes')}</Text>
              <TextInput
                value={settings.syncInterval.toString()}
                onChangeText={(text) => 
                  handleSettingsUpdate({ ...settings, syncInterval: parseInt(text) || 30 })
                }
                keyboardType="numeric"
                style={styles.intervalInput}
              />
            </View>

            <Divider style={styles.divider} />

            <Title style={styles.sectionTitle}>{t('tally.syncEntities')}</Title>
            
            <View style={styles.settingRow}>
              <Text>{t('tally.entity.vouchers')}</Text>
              <Switch
                value={settings.entities.vouchers}
                onValueChange={(value) => 
                  handleSettingsUpdate({ 
                    ...settings, 
                    entities: { ...settings.entities, vouchers: value }
                  })
                }
              />
            </View>

            <View style={styles.settingRow}>
              <Text>{t('tally.entity.items')}</Text>
              <Switch
                value={settings.entities.items}
                onValueChange={(value) => 
                  handleSettingsUpdate({ 
                    ...settings, 
                    entities: { ...settings.entities, items: value }
                  })
                }
              />
            </View>

            <View style={styles.settingRow}>
              <Text>{t('tally.entity.parties')}</Text>
              <Switch
                value={settings.entities.parties}
                onValueChange={(value) => 
                  handleSettingsUpdate({ 
                    ...settings, 
                    entities: { ...settings.entities, parties: value }
                  })
                }
              />
            </View>
          </Card.Content>
        </Card>
      )}
    </ScrollView>
  );

  const renderLogsTab = () => (
    <ScrollView style={styles.tabContent}>
      {syncLogs.map((log) => (
        <Card key={log.id} style={styles.card}>
          <Card.Content>
            <View style={styles.logHeader}>
              <Chip 
                mode="outlined"
                textStyle={{ 
                  color: log.status === 'success' ? '#4CAF50' : 
                        log.status === 'error' ? '#F44336' : '#FF9800'
                }}
              >
                {log.status}
              </Chip>
              <Text style={styles.logDate}>
                {formatDateTime(log.timestamp)}
              </Text>
            </View>
            <Paragraph style={styles.logMessage}>{log.message}</Paragraph>
            <Text style={styles.logType}>{log.type}</Text>
          </Card.Content>
        </Card>
      ))}
      
      {syncLogs.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text>{t('tally.noLogs')}</Text>
        </View>
      )}
    </ScrollView>
  );

  const renderConflictsTab = () => (
    <ScrollView style={styles.tabContent}>
      {syncConflicts.map((conflict) => (
        <Card key={conflict.id} style={styles.card}>
          <Card.Content>
            <View style={styles.conflictHeader}>
              <Title>{t('tally.conflictTitle', { entity: conflict.entityType })}</Title>
              <Chip mode="outlined">{conflict.conflictType}</Chip>
            </View>
            <Paragraph>Entity ID: {conflict.entityId}</Paragraph>
            <Text style={styles.conflictDate}>
              {formatDate(conflict.createdAt)}
            </Text>
            
            <View style={styles.conflictActions}>
              <Button mode="outlined" style={styles.conflictButton}>
                {t('tally.useLocal')}
              </Button>
              <Button mode="outlined" style={styles.conflictButton}>
                {t('tally.useTally')}
              </Button>
              <Button mode="contained" style={styles.conflictButton}>
                {t('tally.merge')}
              </Button>
            </View>
          </Card.Content>
        </Card>
      ))}
      
      {syncConflicts.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text>{t('tally.noConflicts')}</Text>
        </View>
      )}
    </ScrollView>
  );

  if (isLoading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>{t('tally.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <Button
          mode={activeTab === 'status' ? 'contained' : 'outlined'}
          onPress={() => setActiveTab('status')}
          style={styles.tabButton}
        >
          {t('tally.tab.status')}
        </Button>
        <Button
          mode={activeTab === 'settings' ? 'contained' : 'outlined'}
          onPress={() => setActiveTab('settings')}
          style={styles.tabButton}
        >
          {t('tally.tab.settings')}
        </Button>
        <Button
          mode={activeTab === 'logs' ? 'contained' : 'outlined'}
          onPress={() => setActiveTab('logs')}
          style={styles.tabButton}
        >
          {t('tally.tab.logs')}
        </Button>
        <Button
          mode={activeTab === 'conflicts' ? 'contained' : 'outlined'}
          onPress={() => setActiveTab('conflicts')}
          style={styles.tabButton}
        >
          {t('tally.tab.conflicts')}
        </Button>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {activeTab === 'status' && renderStatusTab()}
        {activeTab === 'settings' && renderSettingsTab()}
        {activeTab === 'logs' && renderLogsTab()}
        {activeTab === 'conflicts' && renderConflictsTab()}
      </ScrollView>

      <FAB
        icon="sync"
        style={styles.fab}
        onPress={handleFullSync}
        disabled={isSyncing}
        loading={isSyncing}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabButton: {
    flex: 1,
    marginHorizontal: 2,
  },
  content: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
  },
  card: {
    margin: 16,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressBar: {
    marginVertical: 8,
  },
  progressStage: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  statsContainer: {
    marginTop: 16,
  },
  statsTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  input: {
    marginVertical: 8,
  },
  testButton: {
    marginTop: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 12,
  },
  intervalInput: {
    width: 80,
  },
  divider: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logDate: {
    fontSize: 12,
    color: '#666',
  },
  logMessage: {
    marginVertical: 8,
  },
  logType: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  conflictHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  conflictDate: {
    fontSize: 12,
    color: '#666',
    marginVertical: 8,
  },
  conflictActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  conflictButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
});

export default TallyIntegrationScreen;
