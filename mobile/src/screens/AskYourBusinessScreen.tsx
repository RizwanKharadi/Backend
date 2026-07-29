import React, { useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import {
  useTheme,
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  Card,
  Chip,
  Surface
} from 'react-native-paper';
import { useDispatch, useSelector } from 'react-redux';
import { askBusinessQuestion, clearAiChat, AiMessage } from '../store/slices/aiSlice';
import { RootState, AppDispatch } from '../store';

const AskYourBusinessScreen: React.FC = () => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const { messages, isLoading } = useSelector((state: RootState) => state.ai);
  const selectedCompany = useSelector((state: RootState) => state.company.selectedCompany);
  const [question, setQuestion] = useState('');

  const suggestions = useMemo(
    () => [
      'Sales today',
      'Sales in May 2026',
      'Who has highest outstanding?',
      'Pending payments',
      'Profit this month',
      'Why are expenses increasing?'
    ],
    []
  );

  const handleSend = () => {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    dispatch(askBusinessQuestion(trimmed));
    setQuestion('');
  };

  const handleClear = () => {
    dispatch(clearAiChat());
  };

  const renderItem = ({ item }: { item: AiMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageContainer, isUser ? styles.userMessage : styles.assistantMessage]}>
        <Card
          mode="contained"
          style={{
            backgroundColor: isUser ? theme.colors.primary : theme.colors.elevation.level1
          }}
        >
          <Card.Content>
            <Text style={{ color: isUser ? theme.colors.onPrimary : theme.colors.onSurface }}>
              {item.text}
            </Text>
            <Text style={[styles.timestamp, { color: isUser ? theme.colors.onPrimary : theme.colors.onSurfaceVariant }]}>
              {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
          </Card.Content>
        </Card>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <Surface elevation={0} style={[styles.header, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text variant="titleLarge">Ask your business</Text>
            <Text variant="bodySmall" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
              Your data stays in MongoDB. AI only explains small backend summaries.
            </Text>
            {selectedCompany && (
              <Text variant="bodySmall" style={[styles.company, { color: theme.colors.onSurfaceVariant }]}>
                {selectedCompany.name || selectedCompany.displayName || selectedCompany.id}
              </Text>
            )}
          </View>
          <Button
            compact
            mode="text"
            onPress={handleClear}
            disabled={messages.length === 0}
            style={styles.clearBtn}
          >
            Clear
          </Button>
        </View>

        <View style={styles.suggestionsRow}>
          {suggestions.map((s) => (
            <Chip
              key={s}
              style={styles.chip}
              onPress={() => setQuestion(s)}
              mode="outlined"
              disabled={isLoading}
            >
              {s}
            </Chip>
          ))}
        </View>
      </Surface>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text variant="titleMedium">Try asking:</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
              - “Sales in May 2026”
              {'\n'}- “Who has highest outstanding?”
              {'\n'}- “Profit this month”
            </Text>
          </View>
        }
      />

      <View style={styles.inputContainer}>
        <TextInput
          mode="outlined"
          placeholder="Ask anything about sales, outstanding, profit, expenses..."
          value={question}
          onChangeText={setQuestion}
          style={styles.input}
          multiline
        />
        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={handleSend}
            disabled={!question.trim() || isLoading}
            style={styles.askBtn}
            contentStyle={styles.askBtnContent}
          >
            {isLoading ? 'Thinking...' : 'Ask'}
          </Button>
        </View>
        {isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator animating size="small" />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  subtitle: {
    marginTop: 4,
  },
  company: {
    marginTop: 6,
    fontWeight: '600',
  },
  clearBtn: {
    alignSelf: 'flex-start',
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderRadius: 999,
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  emptyState: {
    paddingVertical: 22,
  },
  messageContainer: {
    marginBottom: 8,
    maxWidth: '85%',
  },
  userMessage: {
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
  },
  timestamp: {
    marginTop: 4,
    fontSize: 10,
    opacity: 0.7,
  },
  inputContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#00000022',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 10,
  },
  input: {
    maxHeight: 100,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 8,
  },
  askBtn: {
    borderRadius: 12,
  },
  askBtnContent: {
    height: 44,
    paddingHorizontal: 18,
  },
  loading: {
    marginTop: 4,
    alignItems: 'flex-start',
  },
});

export default AskYourBusinessScreen;

