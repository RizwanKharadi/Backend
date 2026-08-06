/**
 * HeroCard — the two dark glass hero cards (Net Worth + Receivables).
 * Glassmorphism over the gradient header: translucent navy gradient fill,
 * hairline border, soft shadow. Net Worth shows a trend; Receivables shows a
 * circular progress ring.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Circle } from 'react-native-svg';

import { colors, gradients } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { HeroNetWorth, HeroReceivables } from '../types/dashboard';

type HeroCardProps =
  | {
      variant: 'netWorth';
      data: HeroNetWorth;
      onPress?: () => void;
    }
  | {
      variant: 'receivables';
      data: HeroReceivables;
      onPress?: () => void;
    };

const RING_SIZE = 58;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

const ProgressRing: React.FC<{ progress: number; center: string; label: string }> = ({
  progress,
  center,
  label,
}) => {
  const dashOffset = RING_CIRC * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE }}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.greenBright}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${RING_CIRC}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringValue}>{center}</Text>
        <Text style={styles.ringLabel}>{label}</Text>
      </View>
    </View>
  );
};

const Footer: React.FC = () => (
  <View style={styles.footer}>
    <Text style={styles.footerText}>View Details</Text>
    <Icon name="chevron-right" size={16} color={colors.textOnDarkMuted} />
  </View>
);

/** Display-only footer: explains what the figure is made of instead of drilling down. */
const FormulaFooter: React.FC<{ label: string }> = ({ label }) => (
  <View style={styles.footer}>
    <Text style={styles.formulaText} numberOfLines={2}>
      {label}
    </Text>
  </View>
);

const HeroCard: React.FC<HeroCardProps> = (props) => {
  const isNetWorth = props.variant === 'netWorth';
  const gradient = isNetWorth ? gradients.heroNetWorth : gradients.heroReceivables;
  // No handler ⇒ the card is a read-out, not a link: don't offer a tap target.
  const Wrapper: React.ElementType = props.onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      activeOpacity={0.88}
      onPress={props.onPress}
      style={[styles.shadow, styles.flex]}
      accessibilityRole={props.onPress ? 'button' : 'summary'}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {isNetWorth ? (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Net Worth</Text>
              <Icon name="eye-outline" size={15} color="#9FB6D6" />
            </View>
            <View style={styles.bodyRow}>
              <View style={styles.flexShrink}>
                <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
                  {props.data.value}
                </Text>
                <View style={styles.trendRow}>
                  <Icon
                    name={props.data.trendPositive ? 'trending-up' : 'trending-down'}
                    size={14}
                    color={props.data.trendPositive ? colors.greenBright : colors.danger}
                  />
                  <Text style={styles.trendText}>{props.data.trendLabel}</Text>
                </View>
              </View>
              <View style={styles.trendBubble}>
                <Icon name="chart-line-variant" size={20} color={colors.greenBright} />
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <View style={styles.receivableIcon}>
                <Icon name="account-group-outline" size={14} color={colors.greenBright} />
              </View>
              <Text style={styles.title}>Receivables Overview</Text>
            </View>
            <View style={styles.bodyRow}>
              <View style={styles.flexShrink}>
                <Text style={styles.subLabel}>Total Outstanding</Text>
                <Text style={styles.valueSm} numberOfLines={1} adjustsFontSizeToFit>
                  {props.data.value}
                </Text>
                <Text style={styles.subLabel}>{props.data.partiesLabel}</Text>
              </View>
              <ProgressRing
                progress={props.data.progress}
                center={props.data.ringCenterValue}
                label={props.data.ringCenterLabel}
              />
            </View>
          </>
        )}
        {isNetWorth && props.data.formulaLabel ? (
          <FormulaFooter label={props.data.formulaLabel} />
        ) : (
          <Footer />
        )}
      </LinearGradient>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flex: 1, marginRight: spacing.xs },
  shadow: { ...shadows.card },
  card: {
    height: 170,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    color: colors.textOnDark,
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  receivableIcon: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(34, 230, 90, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: {
    color: colors.textOnDark,
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  valueSm: {
    color: colors.textOnDark,
    fontSize: fontSize.h3,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginVertical: 2,
  },
  subLabel: {
    color: '#9FB6D6',
    fontSize: fontSize.caption,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  trendText: {
    color: colors.greenBright,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  trendBubble: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    color: colors.textOnDark,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    lineHeight: 18,
  },
  ringLabel: {
    color: '#9FB6D6',
    fontSize: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.glassDivider,
    paddingTop: spacing.xs,
  },
  footerText: {
    color: '#CFE0F5',
    fontSize: fontSize.label,
    fontWeight: fontWeight.medium,
  },
  formulaText: {
    // Deliberately below caption size: this is a half-width card and the label
    // has to wrap to two lines without pushing past the card edge.
    color: '#9FB6D6',
    fontSize: 10,
    lineHeight: 12,
    flex: 1,
  },
});

export default React.memo(HeroCard);
