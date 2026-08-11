import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  RefreshControl,
  FlatList,
} from 'react-native';
import {
  Card,
  Title,
  Paragraph,
  Button,
  FAB,
  Chip,
  List,
  Searchbar,
  Menu,
  Divider,
  ActivityIndicator,
  Text,
  Badge,
  IconButton,
} from 'react-native-paper';
import { useAppDispatch, useNotification } from '../store/hooks';
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications,
  fetchUnreadCount,
  setFilters,
  clearFilters,
} from '../store/slices/notificationSlice';
import { formatDate, formatTime } from '../utils/formatters';
import { useTranslation } from 'react-i18next';

const NotificationScreen: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { 
    notifications, 
    unreadCount, 
    isLoading, 
    error, 
    pagination,
    filters 
  } = useNotification();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  useEffect(() => {
    loadNotifications();
    dispatch(fetchUnreadCount());
  }, [filters]);

  const loadNotifications = async () => {
    try {
      await dispatch(fetchNotifications({
        page: 1,
        limit: 20,
        ...filters,
      }));
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    await dispatch(fetchUnreadCount());
    setRefreshing(false);
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await dispatch(markNotificationAsRead(notificationId));
    } catch (error) {
      Alert.alert(t('common.error'), t('notifications.markReadFailed'));
    }
  };

  const handleMarkAllAsRead = async () => {
    Alert.alert(
      t('notifications.markAll.title'),
      t('notifications.markAll.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.yes'),
          onPress: async () => {
            try {
              await dispatch(markAllNotificationsAsRead());
              Alert.alert(t('common.success'), t('notifications.markAll.success'));
            } catch (error) {
              Alert.alert(t('common.error'), t('notifications.markAll.failed'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteNotification = async (notificationId: string) => {
    Alert.alert(
      t('notifications.deleteOne.title'),
      t('notifications.deleteOne.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await dispatch(deleteNotification(notificationId));
            } catch (error) {
              Alert.alert(t('common.error'), t('notifications.deleteOne.failed'));
            }
          },
        },
      ]
    );
  };

  const handleDeleteAllNotifications = async () => {
    Alert.alert(
      t('notifications.deleteAll.title'),
      t('notifications.deleteAll.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('notifications.deleteAll.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await dispatch(deleteAllNotifications());
              Alert.alert(t('common.success'), t('notifications.deleteAll.success'));
            } catch (error) {
              Alert.alert(t('common.error'), t('notifications.deleteAll.failed'));
            }
          },
        },
      ]
    );
  };

  const handleFilterChange = (filter: string) => {
    setSelectedFilter(filter);
    setMenuVisible(false);
    
    const newFilters: any = {};
    
    switch (filter) {
      case 'unread':
        newFilters.isRead = false;
        break;
      case 'read':
        newFilters.isRead = true;
        break;
      case 'info':
        newFilters.type = 'info';
        break;
      case 'success':
        newFilters.type = 'success';
        break;
      case 'warning':
        newFilters.type = 'warning';
        break;
      case 'error':
        newFilters.type = 'error';
        break;
      default:
        // 'all' - clear filters
        break;
    }
    
    if (filter === 'all') {
      dispatch(clearFilters());
    } else {
      dispatch(setFilters(newFilters));
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'warning':
        return 'alert';
      case 'error':
        return 'alert-circle';
      default:
        return 'information';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'success':
        return '#4CAF50';
      case 'warning':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#2196F3';
    }
  };

  const filteredNotifications = notifications.filter(notification =>
    notification.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    notification.message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderNotificationItem = ({ item }: { item: any }) => (
    <Card 
      style={[
        styles.notificationCard,
        !item.isRead && styles.unreadCard
      ]}
    >
      <Card.Content>
        <View style={styles.notificationHeader}>
          <View style={styles.notificationInfo}>
            <List.Icon 
              icon={getNotificationIcon(item.type)}
              color={getNotificationColor(item.type)}
            />
            <View style={styles.notificationText}>
              <Title style={styles.notificationTitle}>{item.title}</Title>
              <Paragraph style={styles.notificationMessage}>
                {item.message}
              </Paragraph>
              <View style={styles.notificationMeta}>
                <Text style={styles.notificationDate}>
                  {formatDate(item.createdAt)} at {formatTime(item.createdAt)}
                </Text>
                <Chip 
                  mode="outlined" 
                  style={styles.categoryChip}
                  textStyle={{ fontSize: 10 }}
                >
                  {item.category}
                </Chip>
              </View>
            </View>
          </View>
          
          <View style={styles.notificationActions}>
            {!item.isRead && (
              <Badge style={styles.unreadBadge} />
            )}
            <IconButton
              icon={item.isRead ? "email-open" : "email"}
              size={20}
              onPress={() => handleMarkAsRead(item.id)}
            />
            <IconButton
              icon="delete"
              size={20}
              onPress={() => handleDeleteNotification(item.id)}
            />
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  if (isLoading && !refreshing && notifications.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>{t('notifications.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Title>{t('notifications.title')}</Title>
          {unreadCount > 0 && (
            <Badge style={styles.unreadCountBadge}>{unreadCount}</Badge>
          )}
        </View>
        
        <View style={styles.headerControls}>
          <Searchbar
            placeholder={t('notifications.searchPlaceholder')}
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
          />
          
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                onPress={() => setMenuVisible(true)}
                style={styles.filterButton}
              >
                {selectedFilter}
              </Button>
            }
          >
            <Menu.Item onPress={() => handleFilterChange('all')} title={t('common.all')} />
            <Menu.Item onPress={() => handleFilterChange('unread')} title={t('notifications.filter.unread')} />
            <Menu.Item onPress={() => handleFilterChange('read')} title={t('notifications.filter.read')} />
            <Divider />
            <Menu.Item onPress={() => handleFilterChange('info')} title={t('notifications.filter.info')} />
            <Menu.Item onPress={() => handleFilterChange('success')} title={t('common.success')} />
            <Menu.Item onPress={() => handleFilterChange('warning')} title={t('common.warning')} />
            <Menu.Item onPress={() => handleFilterChange('error')} title={t('common.error')} />
          </Menu>
        </View>

        <View style={styles.actionButtons}>
          <Button
            mode="outlined"
            onPress={handleMarkAllAsRead}
            style={styles.actionButton}
            disabled={unreadCount === 0}
          >
            {t('notifications.markAllRead')}
          </Button>
          <Button
            mode="outlined"
            onPress={handleDeleteAllNotifications}
            style={styles.actionButton}
            buttonColor="#F44336"
            textColor="white"
            disabled={notifications.length === 0}
          >
            {t('notifications.deleteAll.confirm')}
          </Button>
        </View>
      </View>

      <FlatList
        data={filteredNotifications}
        renderItem={renderNotificationItem}
        keyExtractor={(item) => item.id}
        style={styles.notificationsList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('notifications.empty')}</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  unreadCountBadge: {
    marginLeft: 8,
    backgroundColor: '#F44336',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchbar: {
    flex: 1,
    marginRight: 8,
  },
  filterButton: {
    minWidth: 80,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 4,
  },
  notificationsList: {
    flex: 1,
  },
  notificationCard: {
    margin: 8,
    marginBottom: 4,
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  notificationInfo: {
    flex: 1,
    flexDirection: 'row',
  },
  notificationText: {
    flex: 1,
    marginLeft: 8,
  },
  notificationTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  notificationMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  notificationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationDate: {
    fontSize: 12,
    color: '#999',
  },
  categoryChip: {
    height: 24,
  },
  notificationActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unreadBadge: {
    width: 8,
    height: 8,
    backgroundColor: '#2196F3',
    marginRight: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});

export default NotificationScreen;
