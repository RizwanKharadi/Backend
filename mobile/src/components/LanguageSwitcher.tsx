/**
 * Compact language chip for the dashboard header.
 *
 * Deliberately dashboard-only: it lives in `HeaderSection`, which nothing but
 * PremiumDashboardScreen renders. Every other screen reaches the same picker
 * through Settings → Language, so the control does not need to follow the user
 * around the app.
 */
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { RootState, AppDispatch } from '../store';
import { setLanguage } from '../store/slices/settingsSlice';
import { changeLanguage } from '../i18n';
import { findLanguage } from '../i18n/languages';
import LanguagePickerDialog from './settings/LanguagePickerDialog';
import { GuideTarget } from './guide';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { fontSize, fontWeight } from '../theme/typography';

const LanguageSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const language = useSelector((state: RootState) => state.settings.language);
  const [pickerVisible, setPickerVisible] = useState(false);

  // The chip shows the language in its own script, so someone who has the app
  // in a language they cannot read can still recognise the way out.
  const current = findLanguage(language);
  const label = current?.nativeName ?? language.toUpperCase();

  const handleSelect = async (code: string) => {
    // changeLanguage is the authority — it falls back to English when the
    // requested language has no translation file, and returns what it applied.
    const applied = await changeLanguage(code);
    dispatch(setLanguage(applied));
  };

  return (
    <>
      {/* Wrapped so the App Tour's "Choose Your Language" step can point at it. */}
      <GuideTarget targetId="language-switcher">
      <TouchableOpacity
        style={styles.chip}
        onPress={() => setPickerVisible(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('settings.language.pickerTitle')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="translate" size={14} color={colors.textOnDarkMuted} />
        <Text style={styles.chipText} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="chevron-down" size={16} color={colors.textOnDarkMuted} />
      </TouchableOpacity>
      </GuideTarget>

      <LanguagePickerDialog
        visible={pickerVisible}
        value={language}
        onSelect={handleSelect}
        onDismiss={() => setPickerVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    // Keep a long native name (e.g. "മലയാളം") from pushing the row wide.
    maxWidth: 150,
  },
  chipText: {
    color: colors.white,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
});

export default LanguageSwitcher;
