import React from 'react';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

// Legacy dashboard kept for fallback: import DashboardScreen from '../screens/DashboardScreen';
import PremiumDashboardScreen from '../screens/PremiumDashboardScreen';
import PremiumTransactionsScreen from '../screens/PremiumTransactionsScreen';
import PremiumInventoryScreen from '../screens/PremiumInventoryScreen';
import InventoryScreen from '../screens/InventoryScreen';
import SyncScreen from '../screens/SyncScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BillingScreen from '../screens/BillingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import PaymentPredictionScreen from '../screens/PaymentPredictionScreen';
import RiskAssessmentScreen from '../screens/RiskAssessmentScreen';
import InventoryForecastScreen from '../screens/InventoryForecastScreen';
import ComingSoonScreen from '../screens/ComingSoonScreen';
import LoginHistoryScreen from '../screens/LoginHistoryScreen';
import VoucherDetailScreen from '../screens/VoucherDetailScreen';
import CreateVoucherScreen from '../screens/CreateVoucherScreen';
import CreateNewVoucherScreen from '../screens/vouchers/CreateNewVoucherScreen';
import CreateItemVoucherScreen from '../screens/vouchers/CreateItemVoucherScreen';
import CreateReceiptPaymentScreen from '../screens/vouchers/CreateReceiptPaymentScreen';
import CreateJournalVoucherScreen from '../screens/vouchers/CreateJournalVoucherScreen';
import CreateSalesInvoiceScreen from '../screens/vouchers/CreateSalesInvoiceScreen';
import AddSalesItemScreen from '../screens/vouchers/AddSalesItemScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import CreateItemScreen from '../screens/CreateItemScreen';
import CreateLedgerScreen from '../screens/CreateLedgerScreen';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import CompanySelectionScreen from '../screens/CompanySelectionScreen';
import PaymentScreen from '../screens/PaymentScreen';
import NotificationScreen from '../screens/NotificationScreen';
import TallyIntegrationScreen from '../screens/TallyIntegrationScreen';
import ReportsNavigator from './ReportsNavigator';
import BootstrapGate from '../components/common/BootstrapGate';
import OfflineBanner from '../components/common/OfflineBanner';
import VoucherTypesScreen from '../screens/VoucherTypesScreen';
import FilteredVouchersScreen from '../screens/FilteredVouchersScreen';
import DayBookScreen from '../screens/DayBookScreen';
import PendingSyncScreen from '../screens/PendingSyncScreen';
import { AppGuideProvider, GuideTarget } from '../components/guide';

import { MainTabParamList, MainStackParamList } from '../types/navigation';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<MainStackParamList>();

const GuideTabBar: React.FC<BottomTabBarProps> = (props) => (
  <GuideTarget targetId="tab-bar" style={{ width: '100%' }}>
    <BottomTabBar {...props} />
  </GuideTarget>
);

const TabNavigator: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <>
    <OfflineBanner />
    <Tab.Navigator
      // Back returns to the tab you came from. A report opened from a dashboard
      // tile is pushed as the only route in the Reports stack, so its Back
      // falls through to here and lands back on the Dashboard.
      backBehavior="history"
      tabBar={(props) => <GuideTabBar {...props} />}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string;

          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'view-dashboard' : 'view-dashboard-outline';
              break;
            case 'Transactions':
              iconName = 'swap-horizontal';
              break;
            case 'Inventory':
              iconName = focused ? 'package-variant' : 'package-variant-closed';
              break;
            case 'Reports':
              iconName = 'chart-line';
              break;
            case 'AskYourBusiness':
              iconName = focused ? 'chat' : 'chat-outline';
              break;
            default:
              iconName = 'help-circle';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerShown: false,
        lazy: true,
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={PremiumDashboardScreen}
        options={{
          tabBarLabel: t('nav.dashboard'),
          // The premium dashboard renders its own BottomNavigation + FAB,
          // so hide the default tab bar on this screen.
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={PremiumTransactionsScreen}
        options={{
          tabBarLabel: t('nav.transactions'),
          // Premium screen renders its own BottomNavigation + FAB.
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen
        name="Inventory"
        component={PremiumInventoryScreen}
        options={{
          tabBarLabel: t('nav.inventory'),
          // Premium command center renders its own BottomNavigation + FAB.
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen
        name="Reports"
        component={ReportsNavigator}
        options={{
          tabBarLabel: t('nav.reports'),
          // Premium Reports home renders its own BottomNavigation.
          tabBarStyle: { display: 'none' },
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Tapping Reports always shows the reports list. Checking the
            // focused route name rather than the stack index matters: a report
            // opened from a dashboard tile is the *only* route in this stack
            // (index 0), so an index check would leave that report showing.
            const state = navigation.getState();
            const reportsRoute = state.routes.find((r) => r.name === 'Reports');
            const nested = reportsRoute?.state;
            const focusedName =
              nested?.routes?.[nested.index ?? 0]?.name ?? 'ReportsHome';
            if (focusedName !== 'ReportsHome') {
              e.preventDefault();
              navigation.navigate('Reports', { screen: 'ReportsHome' });
            }
          },
        })}
      />
      <Tab.Screen
        name="AskYourBusiness"
        component={ComingSoonScreen}
        options={{ tabBarLabel: t('nav.chat') }}
      />
    </Tab.Navigator>
    </>
  );
};

const MainNavigator: React.FC = () => {
  return (
    <BootstrapGate>
      <AppGuideProvider autoStart>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Tabs" component={TabNavigator} />

      <Stack.Group screenOptions={{ presentation: 'modal' }}>
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Billing" component={BillingScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="LoginHistory" component={LoginHistoryScreen} />
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
        <Stack.Screen name="CompanySelection" component={CompanySelectionScreen} />
        <Stack.Screen name="Payment" component={PaymentScreen} />
        <Stack.Screen name="Notifications" component={NotificationScreen} />
        <Stack.Screen name="TallyIntegration" component={TallyIntegrationScreen} />
      </Stack.Group>

      <Stack.Screen name="Sync" component={SyncScreen} />
      <Stack.Screen name="VoucherDetail" component={VoucherDetailScreen} />
      <Stack.Screen name="CreateNewVoucher" component={CreateNewVoucherScreen} />
      <Stack.Screen name="CreateItemVoucher" component={CreateItemVoucherScreen} />
      <Stack.Screen name="CreateReceiptPayment" component={CreateReceiptPaymentScreen} />
      <Stack.Screen name="CreateJournal" component={CreateJournalVoucherScreen} />
      <Stack.Screen name="CreateSalesInvoice" component={CreateSalesInvoiceScreen} />
      <Stack.Screen name="AddInvoiceItem" component={AddSalesItemScreen} />
      <Stack.Screen name="AddSalesItem" component={AddSalesItemScreen} />
      <Stack.Screen name="CreateVoucher" component={CreateVoucherScreen} />
      <Stack.Screen name="InventoryList" component={InventoryScreen} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
      <Stack.Screen name="CreateItem" component={CreateItemScreen} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} />
      <Stack.Screen name="CreateLedger" component={CreateLedgerScreen} />
      <Stack.Screen name="VoucherTypes" component={VoucherTypesScreen} />
      <Stack.Screen
        name="FilteredVouchers"
        component={FilteredVouchersScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen name="DayBook" component={DayBookScreen} />
      <Stack.Screen name="PendingSync" component={PendingSyncScreen} />

      <Stack.Screen name="PaymentPrediction" component={PaymentPredictionScreen} />
      <Stack.Screen name="RiskAssessment" component={RiskAssessmentScreen} />
      <Stack.Screen name="InventoryForecast" component={InventoryForecastScreen} />
        </Stack.Navigator>
      </AppGuideProvider>
    </BootstrapGate>
  );
};

export default MainNavigator;
