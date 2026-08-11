import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  TouchableOpacity,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { TextInput, Text, IconButton } from 'react-native-paper';
import { voucherFormTheme } from './voucherFormTheme';
import { useTranslation } from 'react-i18next';

const { height: SCREEN_H } = Dimensions.get('window');

export interface SelectOption {
  id: string;
  label: string;
  subtitle?: string;
}

interface SearchableSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onSelect: (option: SelectOption) => void;
  placeholder?: string;
  leftIcon?: string;
  rightIcon?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Modal title override */
  pickerTitle?: string;
  /** Bump this number to open the picker programmatically (0 = never). */
  openToken?: number;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select',
  leftIcon,
  rightIcon = 'chevron-down',
  disabled = false,
  loading = false,
  pickerTitle,
  openToken = 0,
}) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (openToken > 0 && !disabled && !loading) setVisible(true);
  }, [openToken, disabled, loading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.subtitle && o.subtitle.toLowerCase().includes(q))
    );
  }, [options, query]);

  const display = value || '';
  const showPlaceholder = !display;

  const openPicker = () => {
    if (!disabled && !loading) {
      setVisible(true);
    }
  };

  const closePicker = () => {
    setVisible(false);
    setQuery('');
  };

  const renderRow = ({ item }: { item: SelectOption }) => (
    <TouchableOpacity
      style={[styles.row, item.label === value && styles.rowSelected]}
      onPress={() => {
        onSelect(item);
        closePicker();
      }}
      activeOpacity={0.65}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.label}
        </Text>
        {item.subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
      {item.label === value ? (
        <IconButton icon="check-circle" iconColor={voucherFormTheme.primary} size={22} />
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={openPicker}
        style={styles.pressable}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View pointerEvents="none">
          <TextInput
            label={label}
            value={showPlaceholder ? '' : display}
            placeholder={showPlaceholder ? placeholder : undefined}
            mode="outlined"
            editable={false}
            disabled={disabled || loading}
            left={leftIcon ? <TextInput.Icon icon={leftIcon} /> : undefined}
            right={<TextInput.Icon icon={loading ? 'progress-clock' : rightIcon} />}
            style={styles.input}
            contentStyle={styles.inputContent}
          />
        </View>
      </Pressable>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={closePicker}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={closePicker} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{pickerTitle || label}</Text>
              <IconButton icon="close" onPress={closePicker} size={24} />
            </View>

            <TextInput
              placeholder={t('masters.searchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              mode="outlined"
              left={<TextInput.Icon icon="magnify" />}
              style={styles.searchInput}
              autoFocus
              dense={false}
            />

            <Text style={styles.count}>
              {filtered.length} of {options.length} records
            </Text>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              contentContainerStyle={styles.listContent}
              initialNumToRender={20}
              maxToRenderPerBatch={30}
              windowSize={12}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.empty}>{t('masters.noMatches')}</Text>
                </View>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },
  pressable: {
    width: '100%',
  },
  input: {
    backgroundColor: voucherFormTheme.inputBg,
  },
  inputContent: {
    fontSize: 16,
    minHeight: 28,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: Math.min(SCREEN_H * 0.88, 720),
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 4,
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: voucherFormTheme.border,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: voucherFormTheme.text,
    flex: 1,
  },
  searchInput: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: '#fff',
  },
  count: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    marginHorizontal: 20,
    marginBottom: 8,
    marginTop: 4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: voucherFormTheme.border,
  },
  rowSelected: {
    backgroundColor: '#E8F2FF',
    borderColor: voucherFormTheme.primary,
  },
  rowText: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: voucherFormTheme.text,
    lineHeight: 22,
  },
  rowSubtitle: {
    fontSize: 13,
    color: voucherFormTheme.muted,
    marginTop: 4,
    lineHeight: 18,
  },
  emptyWrap: {
    padding: 40,
    alignItems: 'center',
  },
  empty: {
    fontSize: 15,
    color: voucherFormTheme.muted,
  },
});

export default SearchableSelect;
