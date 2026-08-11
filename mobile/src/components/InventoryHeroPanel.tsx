/**
 * InventoryHeroPanel — dark glass panel under the header showing total
 * Inventory Value (left) and a Stock Health ring (right). Both values are
 * derived from live inventory stats.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle } from 'react-native-svg';

import { colors, gradients } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';
import { useTranslation } from 'react-i18next';

interface InventoryHeroPanelProps {
  value: string;
  itemsLabel: string;
  healthPct: number; // 0..1
  healthSubtitle: string;
}

const RING = 86;
const STROKE = 8;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

const InventoryHeroPanel: React.FC<InventoryHeroPanelProps> = ({
  value,
  itemsLabel,
  healthPct,
  healthSubtitle,
}) => {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(1, healthPct));
  const offset = CIRC * (1 - pct);

  return (
    <LinearGradient
      colors={gradients.heroNetWorth}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.panel, shadows.card]}
    >
      <View style={styles.left}>
        <Text style={styles.label}>{t('inventory.inventoryValue')}</Text>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={styles.sub}>{itemsLabel}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.right}>
        <View style={{ width: RING, height: RING }}>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={R} stroke="rgba(255,255,255,0.14)" strokeWidth={STROKE} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              stroke={colors.greenBright}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
          <View style={styles.ringCenter}>
            <Text style={styles.ringPct}>{Math.round(pct * 100)}%</Text>
          </View>
        </View>
        <View style={styles.rightText}>
          <Text style={styles.rightTitle}>{t('inventory.stockHealth')}</Text>
          <Text style={styles.sub}>{healthSubtitle}</Text>
        </View>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  left: { flex: 1 },
  label: { color: '#CFE0F5', fontSize: fontSize.label, fontWeight: fontWeight.medium },
  value: {
    color: colors.textOnDark,
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  sub: { color: '#9FB6D6', fontSize: fontSize.caption, marginTop: 4 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.glassDivider, marginHorizontal: spacing.md },
  right: { alignItems: 'center', width: 110 },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringPct: { color: colors.textOnDark, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  rightText: { alignItems: 'center', marginTop: spacing.xs },
  rightTitle: { color: colors.textOnDark, fontSize: fontSize.label, fontWeight: fontWeight.semibold },
});

export default React.memo(InventoryHeroPanel);
