import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import {
  Surface,
  Title,
  Paragraph,
  Button,
  Chip,
  Card,
  ProgressBar,
  useTheme,
  SegmentedButtons,
} from 'react-native-paper';
import { useSelector, useDispatch } from 'react-redux';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Components
import Header from '../components/common/Header';
import LoadingScreen from '../components/common/LoadingScreen';

// Store
import { RootState, AppDispatch } from '../store';
import {
  checkMLServiceHealth,
  fetchBusinessMetrics,
  fetchRiskDashboard,
  fetchInventoryAnalytics,
  fetchPaymentTrends,
  fetchModelStatus,
  setSelectedMetricsPeriod,
} from '../store/slices/mlSlice';

// Types
import { MainStackScreenProps, MainStackParamList } from '../types/navigation';
import { formatCurrency } from '../utils/formatters';
import { dashboardColors } from '../components/dashboard/dashboardTheme';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');

type Props = MainStackScreenProps<'MLAnalytics'>;

const PREDICTION_TOOLS = [
  {
    route: 'PaymentPrediction' as const,
    // NOTE: MaterialCommunityIcons does not include "cash-clock" (crashes with icon list dump).
    icon: 'cash-sync',
    color: '#3b82f6',
    title: 'Payment delay prediction',
    description:
      'Predict if a customer will pay late before the due date. Helps collections and credit decisions.',
    howTo:
      'Enter party name as Customer ID, optional amount and due date, then tap Predict.',
  },
  {
    route: 'RiskAssessment' as const,
    icon: 'shield-alert',
    color: '#dc2626',
    title: 'Customer risk assessment',
    description:
      'Score credit and payment risk using history from synced Tally vouchers.',
    howTo:
      'Enter supplier/customer ledger name, choose Overall, Credit, or Payment focus.',
  },
  {
    route: 'InventoryForecast' as const,
    icon: 'chart-timeline-variant',
    color: '#10b981',
    title: 'Inventory demand forecast',
    description:
      'Forecast stock demand and get reorder quantity suggestions for the next 30–90 days.',
    howTo:
      'Leave the item field empty to cover your busiest items, or type item names exactly as they appear in Tally, separated by commas.',
  },
];

const MLAnalyticsScreen: React.FC<Props> = ({ navigation }) => {
  // This screen sits in the main stack alongside the three tools, so it can push
  // them directly. It previously reached for getParent(), which only made sense
  // while it was expected to live in the tab navigator — it was never registered
  // anywhere, so that path had never actually run.
  const openTool = (route: keyof MainStackParamList) => {
    navigation.navigate(route as never);
  };
  const theme = useTheme();
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const {
    isMLServiceAvailable,
    mlServiceHealth,
    businessMetrics,
    businessMetricsLoading,
    riskDashboard,
    riskDashboardLoading,
    inventoryAnalytics,
    inventoryAnalyticsLoading,
    paymentTrends,
    paymentTrendsLoading,
    modelStatus,
    selectedMetricsPeriod,
    error,
    lastUpdated,
  } = useSelector((state: RootState) => state.ml);

  const [refreshing, setRefreshing] = useState(false);
  const [selectedTab, setSelectedTab] = useState('overview');

  useEffect(() => {
    initializeMLData();
  }, [dispatch]);

  const initializeMLData = async () => {
    try {
      // Check ML service health first
      await dispatch(checkMLServiceHealth()).unwrap();
      
      // Load all ML data
      await Promise.all([
        dispatch(fetchBusinessMetrics(selectedMetricsPeriod)),
        dispatch(fetchRiskDashboard()),
        dispatch(fetchInventoryAnalytics()),
        dispatch(fetchPaymentTrends()),
        dispatch(fetchModelStatus()),
      ]);
    } catch (error) {
      console.error('Failed to initialize ML data:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await initializeMLData();
    setRefreshing(false);
  };

  const handlePeriodChange = (period: number) => {
    dispatch(setSelectedMetricsPeriod(period));
    dispatch(fetchBusinessMetrics(period));
  };


  const formatPercentage = (value?: number | null): string => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'N/A';
    }
    return `${(value * 100).toFixed(1)}%`;
  };

  const getRiskColor = (riskLevel: string): string => {
    switch (riskLevel.toLowerCase()) {
      case 'high':
        return theme.colors.error;
      case 'medium':
        return '#f59e0b';
      case 'low':
        return theme.colors.primary;
      default:
        return theme.colors.onSurfaceVariant;
    }
  };

  if (!isMLServiceAvailable) {
    return (
      <View style={styles.container}>
        <Header
          title="AI Insights"
          subtitle="ML service unavailable"
          showBack={navigation.canGoBack()}
          onBackPress={() => navigation.goBack()}
        />
        
        <View style={styles.errorContainer}>
          <Icon
            name="robot-outline"
            size={80}
            color={theme.colors.error}
          />
          <Title style={[styles.errorTitle, { color: theme.colors.error }]}>
            ML Service Unavailable
          </Title>
          <Paragraph style={[styles.errorText, { color: theme.colors.onSurfaceVariant }]}>
            The AI/ML service is currently unavailable. Please check your connection and try again.
          </Paragraph>
          <Button
            mode="contained"
            onPress={handleRefresh}
            style={styles.retryButton}
            icon="refresh"
          >
            Retry
          </Button>
        </View>
      </View>
    );
  }

  if (businessMetricsLoading && !businessMetrics) {
    return <LoadingScreen message="Loading AI insights..." />;
  }

  const renderOverviewTab = () => (
    <View style={styles.tabContent}>
      {/* Period Selector */}
      <Surface style={styles.card} elevation={2}>
        <Title style={styles.cardTitle}>Analysis Period</Title>
        <SegmentedButtons
          value={selectedMetricsPeriod.toString()}
          onValueChange={(value) => handlePeriodChange(parseInt(value))}
          buttons={[
            { value: '7', label: '7 Days' },
            { value: '30', label: '30 Days' },
            { value: '90', label: '90 Days' },
          ]}
        />
      </Surface>

      {/* Before the first sync there is genuinely nothing to show. Say so, rather
          than rendering a screen of zeroes that reads like a failing business. */}
      {!businessMetricsLoading && !businessMetrics && !modelStatus ? (
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>{t('ml.empty.title')}</Title>
          <Paragraph style={styles.helpText}>{t('ml.empty.needsSync')}</Paragraph>
        </Surface>
      ) : null}

      {/* Business Metrics */}
      {businessMetrics && (
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>Business Performance</Title>
          
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Icon name="trending-up" size={24} color={theme.colors.primary} />
              <Paragraph style={styles.metricLabel}>Revenue Growth</Paragraph>
              <Title style={[styles.metricValue, { color: theme.colors.primary }]}>
                {formatPercentage(businessMetrics.revenue_forecast?.growth_rate)}
              </Title>
            </View>
            
            <View style={styles.metricItem}>
              <Icon name="clock-check" size={24} color={theme.colors.tertiary} />
              <Paragraph style={styles.metricLabel}>On-time Payments</Paragraph>
              <Title style={[styles.metricValue, { color: theme.colors.tertiary }]}> 
                {formatPercentage(businessMetrics.payment_insights?.on_time_percentage)}
              </Title>
            </View>
            
            <View style={styles.metricItem}>
              <Icon name="account-group" size={24} color={theme.colors.secondary} />
              <Paragraph style={styles.metricLabel}>Total Customers</Paragraph>
              <Title style={[styles.metricValue, { color: theme.colors.secondary }]}>
                {businessMetrics.customer_analytics?.total_customers ?? 'N/A'}
              </Title>
            </View>
            
            <View style={styles.metricItem}>
              <Icon name="package-variant" size={24} color={theme.colors.tertiary} />
              <Paragraph style={styles.metricLabel}>Inventory Items</Paragraph>
              <Title style={[styles.metricValue, { color: theme.colors.tertiary }]}>
                {businessMetrics.inventory_insights?.total_items ?? 'N/A'}
              </Title>
            </View>
          </View>
        </Surface>
      )}

      {/* Risk Summary */}
      {riskDashboard && (
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>Risk Overview</Title>
          
          <View style={styles.riskSummary}>
            <View style={styles.riskItem}>
              <Chip
                mode="outlined"
                style={[styles.riskChip, { borderColor: theme.colors.error }]}
                textStyle={{ color: theme.colors.error }}
              >
                {(riskDashboard.summary?.total_high_risk ?? 0)} High Risk
              </Chip>
            </View>
            
            <View style={styles.riskItem}>
              <Chip
                mode="outlined"
                style={[styles.riskChip, { borderColor: '#f59e0b' }]}
                textStyle={{ color: '#f59e0b' }}
              >
                {(riskDashboard.summary?.total_overdue ?? 0)} Overdue
              </Chip>
            </View>
            
            <View style={styles.riskItem}>
              <Chip
                mode="outlined"
                style={[styles.riskChip, { borderColor: theme.colors.tertiary }]}
                textStyle={{ color: theme.colors.tertiary }}
              >
                {(riskDashboard.summary?.total_credit_alerts ?? 0)} Credit Alerts
              </Chip>
            </View>
          </View>
        </Surface>
      )}

      {/* Model Status */}
      {modelStatus && (
        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>AI Model Status</Title>
          
          {modelStatus.models && Object.keys(modelStatus.models).length > 0 ? (
            <View style={styles.modelGrid}>
              {Object.entries(modelStatus.models).map(([modelName, model]) => (
                <View key={modelName} style={styles.modelItem}>
                  <View style={styles.modelHeader}>
                    <Icon
                      name={model.status === 'active' ? 'check-circle' : 'timer-sand'}
                      size={16}
                      color={
                        model.status === 'active'
                          ? theme.colors.primary
                          : theme.colors.onSurfaceVariant
                      }
                    />
                    <Paragraph style={styles.modelName}>
                      {modelName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </Paragraph>
                  </View>
                  {/* Readiness, not accuracy. Nothing is trained, so there is no
                      accuracy to report — the bar shows how much of the data each
                      insight needs has actually arrived. */}
                  <Paragraph style={styles.modelAccuracy}>
                    {model.message || `Data readiness: ${formatPercentage(model.readiness)}`}
                  </Paragraph>
                  <ProgressBar
                    progress={typeof model.readiness === 'number' ? model.readiness : 0}
                    color={
                      model.status === 'active' ? theme.colors.primary : theme.colors.outline
                    }
                    style={styles.accuracyBar}
                  />
                </View>
              ))}
            </View>
          ) : (
            <Paragraph style={styles.helpText}>
              Model status data is not available at the moment.
            </Paragraph>
          )}
        </Surface>
      )}
    </View>
  );

  const renderPredictionsTab = () => (
    <View style={styles.tabContent}>
      <Surface style={styles.aboutCard} elevation={1}>
        <Icon name="robot" size={28} color={dashboardColors.accent} />
        <View style={styles.aboutText}>
          <Title style={styles.aboutTitle}>How these are worked out</Title>
          <Paragraph style={styles.aboutBody}>
            Every figure is calculated from the data your desktop agent syncs
            across from Tally — sales, parties, stock and outstanding bills — so
            it reconciles with what Tally shows. Each insight tells you what it
            is based on, and says so plainly when there is not enough history
            yet. Keep Tally and the desktop agent syncing to build that history.
          </Paragraph>
        </View>
      </Surface>

      <Title style={styles.toolsHeading}>Prediction tools</Title>
      {PREDICTION_TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.route}
          activeOpacity={0.85}
          onPress={() => openTool(tool.route)}
        >
          <Surface style={styles.toolCard} elevation={2}>
            <View style={[styles.toolIconWrap, { backgroundColor: `${tool.color}18` }]}>
              <Icon name={tool.icon} size={26} color={tool.color} />
            </View>
            <View style={styles.toolBody}>
              <Title style={styles.toolTitle}>{tool.title}</Title>
              <Paragraph style={styles.toolDesc}>{tool.description}</Paragraph>
              <Paragraph style={styles.toolHow}>
                <Paragraph style={styles.toolHowLabel}>How to use: </Paragraph>
                {tool.howTo}
              </Paragraph>
            </View>
            <Icon name="chevron-right" size={24} color={dashboardColors.muted} />
          </Surface>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <Header
        title="AI Insights"
        subtitle="Powered by ML Service"
        showBack={navigation.canGoBack()}
        onBackPress={() => navigation.goBack()}
      />

      <View style={styles.tabSelector}>
        <SegmentedButtons
          value={selectedTab}
          onValueChange={setSelectedTab}
          buttons={[
            { value: 'overview', label: 'Overview' },
            { value: 'predictions', label: 'Predictions' },
          ]}
        />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {selectedTab === 'overview' ? renderOverviewTab() : renderPredictionsTab()}
        
        <View style={styles.bottomSpacing} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dashboardColors.pageBg,
  },
  aboutCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 14,
    gap: 14,
    backgroundColor: '#eff6ff',
  },
  aboutText: { flex: 1 },
  aboutTitle: { fontSize: 17, marginBottom: 6 },
  aboutBody: { fontSize: 13, color: '#475569', lineHeight: 19 },
  toolsHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  toolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    gap: 12,
  },
  toolIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBody: { flex: 1 },
  toolTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  toolDesc: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  toolHow: { fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 17 },
  toolHowLabel: { fontWeight: '700', color: '#64748b' },
  content: {
    flex: 1,
    padding: 16,
  },
  tabSelector: {
    padding: 16,
    paddingBottom: 0,
  },
  tabContent: {
    gap: 16,
  },
  card: {
    padding: 16,
    borderRadius: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metricItem: {
    flex: 1,
    minWidth: (width - 64) / 2,
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 8,
  },
  metricLabel: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  riskSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  riskItem: {
    flex: 1,
    minWidth: 100,
  },
  riskChip: {
    width: '100%',
  },
  modelGrid: {
    gap: 12,
  },
  modelItem: {
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    borderRadius: 8,
  },
  modelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
  },
  modelAccuracy: {
    fontSize: 12,
    marginBottom: 8,
  },
  accuracyBar: {
    height: 4,
    borderRadius: 2,
  },
  helpText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
  },
  bottomSpacing: {
    height: 20,
  },
});

export default MLAnalyticsScreen;
