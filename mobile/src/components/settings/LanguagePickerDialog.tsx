import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Dialog, Portal, Button, RadioButton, Text, useTheme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { availableLanguages } from '../../i18n/languages';

interface Props {
  visible: boolean;
  /** Currently selected language code. */
  value: string;
  onSelect: (code: string) => void;
  onDismiss: () => void;
}

/**
 * Language chooser. Each option is labelled in its own language — someone who
 * has the app in a language they cannot read still needs to find their way out,
 * so "हिन्दी" is more useful here than "Hindi".
 */
const LanguagePickerDialog: React.FC<Props> = ({ visible, value, onSelect, onDismiss }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const languages = availableLanguages();

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{t('settings.language.pickerTitle')}</Dialog.Title>
        <Dialog.ScrollArea style={styles.scrollArea}>
          <ScrollView>
            <RadioButton.Group
              value={value}
              onValueChange={(code) => {
                onSelect(code);
                onDismiss();
              }}
            >
              {languages.map((lang) => (
                <RadioButton.Item
                  key={lang.code}
                  label={lang.nativeName}
                  value={lang.code}
                  accessibilityLabel={`${lang.nativeName} (${lang.englishName})`}
                />
              ))}
            </RadioButton.Group>

            <View style={styles.noteBox}>
              <Text
                variant="bodySmall"
                style={[styles.note, { color: theme.colors.onSurfaceVariant }]}
              >
                {t('settings.language.note')}
              </Text>
            </View>
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  scrollArea: {
    paddingHorizontal: 0,
    maxHeight: 420,
  },
  noteBox: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  note: {
    lineHeight: 18,
  },
});

export default LanguagePickerDialog;
