import React from 'react';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from 'react-native-paper';

import DashboardScreen from '../screens/DashboardScreen';
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

  return (
    <>
    <OfflineBanner />
    <Tab.Navigator
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
        component={DashboardScreen}
        options={{ tabBarLabel: 'Dashboard' }}
      />
      <Tab.Screen
        name="Transactions"
        component={VoucherTypesScreen}
        options={{ tabBarLabel: 'Transactions' }}
      />
      <Tab.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{ tabBarLabel: 'Inventory' }}
      />
      <Tab.Screen
        name="Reports"
        component={ReportsNavigator}
        options={{ tabBarLabel: 'Reports' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            const state = navigation.getState();
            const reportsRoute = state.routes.find((r) => r.name === 'Reports');
            const nestedIndex = reportsRoute?.state?.index ?? 0;
            if (nestedIndex > 0) {
              e.preventDefault();
              navigation.navigate('Reports', { screen: 'ReportsHome' });
            }
          },
        })}
      />
      <Tab.Screen
        name="AskYourBusiness"
        component={ComingSoonScreen}
        options={{ tabBarLabel: 'Chat' }}
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

      <Stack.Screen name="PaymentPrediction" component={PaymentPredictionScreen} />
      <Stack.Screen name="RiskAssessment" component={RiskAssessmentScreen} />
      <Stack.Screen name="InventoryForecast" component={InventoryForecastScreen} />
        </Stack.Navigator>
      </AppGuideProvider>
    </BootstrapGate>
  );
};

export default MainNavigator;
