import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import {
  Surface,
  Title,
  Paragraph,
  TextInput,
  Button,
  Chip,
  ProgressBar,
  useTheme,
} from 'react-native-paper';
import { useDispatch } from 'react-redux';
import { useForm, Controller } from 'react-hook-form';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import Header from '../components/common/Header';
import { AppDispatch } from '../store';
import { forecastInventoryDemand } from '../store/slices/mlSlice';
import { mlService, InventoryForecastResponse } from '../services/mlService';
import { MainStackScreenProps } from '../types/navigation';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

type Props = MainStackScreenProps<'InventoryForecast'>;

interface FormValues {
  item_ids: string;
  days_ahead: string;
}

const InventoryForecastScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const [loading, setLoading] = useState(false);
  const [forecasts, setForecasts] = useState<InventoryForecastResponse[]>([]);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { item_ids: '', days_ahead: '90' },
  });

  const onSubmit = async (data: FormValues) => {
    try {
      setLoading(true);
      const ids = data.item_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await dispatch(
        forecastInventoryDemand({
          item_ids: ids.length > 0 ? ids : undefined,
          days_ahead: parseInt(data.days_ahead, 10) || 90,
        })
      ).unwrap();
      setForecasts(Array.isArray(result) ? result : []);
      if (!result?.length) {
        Alert.alert('No forecast', 'No items matched. Leave item IDs empty to forecast all stocked items.');
      }
    } catch (err: any) {
      Alert.alert(
        'Forecast failed',
        err || 'Could not run inventory forecast. Ensure ML service is running and data is synced.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header
        title="Inventory Forecast"
        subtitle="Demand & reorder predictions"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Surface style={styles.infoCard} elevation={1}>
          <Icon name="chart-timeline-variant" size={22} color={dashboardColors.accent} />
          <View style={styles.infoText}>
            <Paragraph style={styles.infoTitle}>What is this?</Paragraph>
            <Paragraph style={styles.infoBody}>
              Uses sales and purchase history from MongoDB to predict how much stock
              you will need. Suggests when to reorder and how many units — helps avoid
              stock-outs and overstocking.
            </Paragraph>
          </View>
        </Surface>

        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>Run forecast</Title>

          <Controller
            control={control}
            name="item_ids"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Item IDs (optional)"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                mode="outlined"
                placeholder="Leave empty for all items, or id1, id2"
                multiline
                style={styles.input}
              />
            )}
          />

          <Controller
            control={control}
            name="days_ahead"
            rules={{
              required: 'Forecast period is required',
              min: { value: 1, message: 'Min 1 day' },
            }}
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Forecast period (days)"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                mode="outlined"
                keyboardType="numeric"
                left={<TextInput.Icon icon="calendar-range" />}
                style={styles.input}
              />
            )}
          />
          {errors.days_ahead ? (
            <Paragraph style={{ color: theme.colors.error, fontSize: 12 }}>
              {errors.days_ahead.message}
            </Paragraph>
          ) : null}

          <View style={styles.buttonRow}>
            <Button
              mode="outlined"
              onPress={() => {
                reset();
                setForecasts([]);
              }}
              disabled={loading}
            >
              Clear
            </Button>
            <Button
              mode="contained"
              onPress={handleSubmit(onSubmit)}
              loading={loading}
              disabled={loading}
              icon="chart-areaspline"
              style={styles.runBtn}
            >
              Forecast
            </Button>
          </View>
        </Surface>

        {forecasts.map((item) => {
          const rec = item.reorder_recommendation;
          const urgent = rec?.should_reorder;
          return (
            <Surface key={item.item_id} style={styles.card} elevation={2}>
              <View style={styles.itemHeader}>
                <Title style={styles.itemName} numberOfLines={2}>
                  {item.item_name || item.item_id}
                </Title>
                {urgent ? (
                  <Chip icon="alert" style={styles.urgentChip} textStyle={styles.urgentText}>
                    Reorder
                  </Chip>
                ) : null}
              </View>

              <View style={styles.statGrid}>
                <View style={styles.stat}>
                  <Paragraph style={styles.statLabel}>Current stock</Paragraph>
                  <Title style={styles.statValue}>{item.current_stock}</Title>
                </View>
                <View style={styles.stat}>
                  <Paragraph style={styles.statLabel}>Confidence</Paragraph>
                  <Title style={styles.statValue}>
                    {mlService.formatConfidenceScore(item.confidence_score)}
                  </Title>
                </View>
              </View>
              <ProgressBar
                progress={Math.min(1, item.confidence_score || 0)}
                color={dashboardColors.accent}
                style={styles.bar}
              />

              {rec ? (
                <View style={styles.recBox}>
                  <Paragraph style={styles.recTitle}>Reorder suggestion</Paragraph>
                  <Paragraph>
                    Qty: <Paragraph style={styles.bold}>{rec.recommended_quantity}</Paragraph>
                    {rec.reorder_date ? ` · By ${rec.reorder_date}` : ''}
                  </Paragraph>
                  {rec.reason ? (
                    <Paragraph style={styles.reason}>{rec.reason}</Paragraph>
                  ) : null}
                </View>
              ) : null}

              {item.predicted_demand?.length > 0 ? (
                <View style={styles.demandSection}>
                  <Paragraph style={styles.recTitle}>Demand outlook (sample)</Paragraph>
                  {item.predicted_demand.slice(0, 5).map((d, i) => (
                    <View key={i} style={styles.demandRow}>
                      <Paragraph style={styles.demandDate}>{d.date}</Paragraph>
                      <Paragraph style={styles.demandQty}>
                        {d.predicted_demand} units
                      </Paragraph>
                    </View>
                  ))}
                  {item.predicted_demand.length > 5 ? (
                    <Paragraph style={styles.more}>
                      +{item.predicted_demand.length - 5} more days
                    </Paragraph>
                  ) : null}
                </View>
              ) : null}
            </Surface>
          );
        })}

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dashboardColors.pageBg },
  content: { flex: 1, padding: 16 },
  infoCard: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
    backgroundColor: '#f0fdf4',
  },
  infoText: { flex: 1 },
  infoTitle: { fontWeight: '600', marginBottom: 4, color: '#166534' },
  infoBody: { fontSize: 13, color: '#334155', lineHeight: 18 },
  card: { padding: 16, borderRadius: 12, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  input: { marginBottom: 12 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  runBtn: { flex: 2 },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  itemName: { flex: 1, fontSize: 17 },
  urgentChip: { backgroundColor: '#fef3c7' },
  urgentText: { fontSize: 11 },
  statGrid: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  stat: { flex: 1 },
  statLabel: { fontSize: 12, color: dashboardColors.muted },
  statValue: { fontSize: 18 },
  bar: { height: 6, borderRadius: 3, marginBottom: 12 },
  recBox: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  recTitle: { fontWeight: '600', marginBottom: 6 },
  bold: { fontWeight: '700' },
  reason: { fontSize: 13, color: dashboardColors.muted, marginTop: 4 },
  demandSection: { marginTop: 4 },
  demandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  demandDate: { fontSize: 13, color: dashboardColors.muted },
  demandQty: { fontSize: 13, fontWeight: '600' },
  more: { fontSize: 12, color: dashboardColors.muted, marginTop: 6 },
  bottomSpacing: { height: 24 },
});

export default InventoryForecastScreen;
