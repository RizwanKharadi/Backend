/**
 * Searchable picker for a party or stock item name.
 *
 * The insight endpoints match names exactly (after trimming and lowercasing), so
 * a trailing space or "Trader" instead of "Traders" returns nothing and looks
 * like the feature is broken. Picking from the synced list removes that whole
 * class of failure, since the value submitted is the name as Tally stores it.
 *
 * The field it sits beside stays typeable on purpose: the backend can also score
 * a party that appears on Tally's outstanding report without having a party
 * record of its own, and such a party would never show up in this list.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import {
  Modal,
  Portal,
  Searchbar,
  Paragraph,
  Title,
  ActivityIndicator,
  Divider,
  useTheme,
} from 'react-native-paper';

export interface PickerOption {
  /** Submitted verbatim — must be the name as stored. */
  name: string;
  /** Optional second line, e.g. an outstanding amount or stock on hand. */
  subtitle?: string;
}

interface Props {
  visible: boolean;
  title: string;
  placeholder?: string;
  onDismiss: () => void;
  onSelect: (name: string) => void;
  /** Called on open and on each search change; should be cheap to repeat. */
  load: (search: string) => Promise<PickerOption[]>;
}

const NamePicker: React.FC<Props> = ({
  visible,
  title,
  placeholder,
  onDismiss,
  onSelect,
  load,
}) => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(
    async (term: string) => {
      setLoading(true);
      setFailed(false);
      try {
        setOptions(await load(term));
      } catch {
        // A failed lookup must not block the screen — the field is still
        // typeable, so the user can carry on.
        setOptions([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [load]
  );

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    run('');
  }, [visible, run]);

  useEffect(() => {
    if (!visible) return;
    // Debounced so typing does not fire a request per keystroke.
    const timer = setTimeout(() => run(search), 300);
    return () => clearTimeout(timer);
  }, [search, visible, run]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[
          styles.modal,
          { backgroundColor: theme.colors.surface },
        ]}
      >
        <Title style={styles.title}>{title}</Title>

        <Searchbar
          placeholder={placeholder || 'Search'}
          value={search}
          onChangeText={setSearch}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {loading ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <FlatList
            data={options}
            keyExtractor={(item, i) => `${item.name}-${i}`}
            ItemSeparatorComponent={Divider}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              <Paragraph style={styles.empty}>
                {failed
                  ? 'Could not load the list. You can still type the name.'
                  : search
                    ? 'Nothing matched. Check the spelling, or type the name.'
                    : 'Nothing synced from Tally yet.'}
              </Paragraph>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  onSelect(item.name);
                  onDismiss();
                }}
              >
                <Paragraph style={styles.name}>{item.name}</Paragraph>
                {item.subtitle ? (
                  <Paragraph style={styles.subtitle}>{item.subtitle}</Paragraph>
                ) : null}
              </TouchableOpacity>
            )}
          />
        )}
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modal: {
    margin: 20,
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
  },
  title: { fontSize: 18, marginBottom: 12 },
  search: { marginBottom: 8 },
  spinner: { paddingVertical: 32 },
  list: { flexGrow: 0 },
  row: { paddingVertical: 12, paddingHorizontal: 4 },
  name: { fontSize: 15 },
  subtitle: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  empty: { textAlign: 'center', opacity: 0.6, paddingVertical: 24 },
});

export default NamePicker;
