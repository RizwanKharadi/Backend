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
  SegmentedButtons,
} from 'react-native-paper';
import { useDispatch } from 'react-redux';
import { useForm, Controller } from 'react-hook-form';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import Header from '../components/common/Header';
import { AppDispatch } from '../store';
import { assessCustomerRisk } from '../store/slices/mlSlice';
import { mlService } from '../services/mlService';
import { MainStackScreenProps } from '../types/navigation';
import { dashboardColors } from '../components/dashboard/dashboardTheme';

type Props = MainStackScreenProps<'RiskAssessment'>;

interface FormValues {
  customer_id: string;
  assessment_type: string;
}

const RiskAssessmentScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const [loading, setLoading] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    defaultValues: {
      customer_id: '',
      assessment_type: 'overall',
    },
  });

  const assessmentType = watch('assessment_type');

  const onSubmit = async (data: FormValues) => {
    try {
      setLoading(true);
      const result = await dispatch(
        assessCustomerRisk({
          customer_id: data.customer_id.trim(),
          assessment_type: data.assessment_type,
        })
      ).unwrap();
      setAssessment(result.assessment);
    } catch (err: any) {
      Alert.alert(
        'Assessment failed',
        err || 'Could not assess customer risk. Ensure ML service is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  const formatPct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const riskLevel = assessment?.risk_level || '';
  const riskColor = mlService.getRiskColor(riskLevel);

  return (
    <View style={styles.container}>
      <Header
        title="Risk Assessment"
        subtitle="Customer credit & payment risk"
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Surface style={styles.infoCard} elevation={1}>
          <Icon name="information-outline" size={22} color={dashboardColors.accent} />
          <View style={styles.infoText}>
            <Paragraph style={styles.infoTitle}>What is this?</Paragraph>
            <Paragraph style={styles.infoBody}>
              The ML service analyses payment history, outstanding balances, and
              credit behaviour to score how risky a customer or supplier is. Use
              party name or ledger name as Customer ID (same as in Tally).
            </Paragraph>
          </View>
        </Surface>

        <Surface style={styles.card} elevation={2}>
          <Title style={styles.cardTitle}>Assess customer</Title>

          <Controller
            control={control}
            name="customer_id"
            rules={{ required: 'Customer / party name is required' }}
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Customer / Party name *"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                mode="outlined"
                placeholder="e.g. Keshav Computer Pvt.Ltd."
                style={styles.input}
              />
            )}
          />
          {errors.customer_id ? (
            <Paragraph style={{ color: theme.colors.error, fontSize: 12 }}>
              {errors.customer_id.message}
            </Paragraph>
          ) : null}

          <Paragraph style={styles.fieldLabel}>Assessment focus</Paragraph>
          <Controller
            control={control}
            name="assessment_type"
            render={({ field: { onChange, value } }) => (
              <SegmentedButtons
                value={value}
                onValueChange={onChange}
                buttons={[
                  { value: 'overall', label: 'Overall' },
                  { value: 'credit', label: 'Credit' },
                  { value: 'payment', label: 'Payment' },
                ]}
                style={styles.segment}
              />
            )}
          />
          <Paragraph style={styles.hint}>
            {assessmentType === 'credit'
              ? 'Credit limit and utilisation focus'
              : assessmentType === 'payment'
                ? 'Late payment and delay patterns'
                : 'Combined credit and payment risk'}
          </Paragraph>

          <View style={styles.buttonRow}>
            <Button mode="outlined" onPress={() => { reset(); setAssessment(null); }} disabled={loading}>
              Clear
            </Button>
            <Button
              mode="contained"
              onPress={handleSubmit(onSubmit)}
              loading={loading}
              disabled={loading}
              icon="shield-search"
              style={styles.runBtn}
            >
              Assess
            </Button>
          </View>
        </Surface>

        {assessment ? (
          <Surface style={styles.card} elevation={2}>
            <Title style={styles.cardTitle}>Results</Title>
            <View style={styles.riskHeader}>
              <Icon name="shield-alert" size={36} color={riskColor} />
              <View style={styles.riskInfo}>
                <Title style={[styles.riskLevel, { color: riskColor }]}>
                  {riskLevel} risk
                </Title>
                <Paragraph>{assessment.customer_id}</Paragraph>
              </View>
            </View>

            <View style={styles.scoreRow}>
              <Paragraph>Risk score</Paragraph>
              <Title>{formatPct(assessment.risk_score)}</Title>
            </View>
            <ProgressBar
              progress={Math.min(1, assessment.risk_score || 0)}
              color={riskColor}
              style={styles.bar}
            />

            {assessment.risk_factors?.length > 0 ? (
              <View style={styles.section}>
                <Paragraph style={styles.sectionTitle}>Risk factors</Paragraph>
                {assessment.risk_factors.map((f: any, i: number) => (
                  <View key={i} style={styles.factorRow}>
                    <Chip mode="outlined" compact style={styles.factorChip}>
                      {f.factor}
                    </Chip>
                    <Paragraph style={styles.factorDesc} numberOfLines={3}>
                      {f.description || `Impact: ${formatPct(f.impact || 0)}`}
                    </Paragraph>
                  </View>
                ))}
              </View>
            ) : null}

            {assessment.recommendations?.length > 0 ? (
              <View style={styles.section}>
                <Paragraph style={styles.sectionTitle}>Recommendations</Paragraph>
                {assessment.recommendations.map((rec: string, i: number) => (
                  <View key={i} style={styles.recRow}>
                    <Icon name="lightbulb-outline" size={16} color={dashboardColors.warning} />
                    <Paragraph style={styles.recText}>{rec}</Paragraph>
                  </View>
                ))}
              </View>
            ) : null}
          </Surface>
        ) : null}

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
    backgroundColor: '#eff6ff',
  },
  infoText: { flex: 1 },
  infoTitle: { fontWeight: '600', marginBottom: 4, color: '#1e40af' },
  infoBody: { fontSize: 13, color: '#334155', lineHeight: 18 },
  card: { padding: 16, borderRadius: 12, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  input: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, marginBottom: 8, color: dashboardColors.muted },
  segment: { marginBottom: 8 },
  hint: { fontSize: 12, color: dashboardColors.muted, marginBottom: 12 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  runBtn: { flex: 2 },
  riskHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  riskInfo: { marginLeft: 14, flex: 1 },
  riskLevel: { fontSize: 22, fontWeight: 'bold' },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bar: { height: 8, borderRadius: 4, marginBottom: 16 },
  section: { marginTop: 8 },
  sectionTitle: { fontWeight: '600', marginBottom: 10 },
  factorRow: { marginBottom: 12 },
  factorChip: { alignSelf: 'flex-start', marginBottom: 4 },
  factorDesc: { fontSize: 13, color: dashboardColors.muted },
  recRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  recText: { flex: 1, fontSize: 14 },
  bottomSpacing: { height: 24 },
});

export default RiskAssessmentScreen;
