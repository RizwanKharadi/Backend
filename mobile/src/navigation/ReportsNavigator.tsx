import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PremiumReportsScreen from '../screens/PremiumReportsScreen';
import VouchersScreen from '../screens/VouchersScreen';
import ProfitLossScreen from '../screens/reports/ProfitLossScreen';
import ProfitLossGroupScreen from '../screens/reports/ProfitLossGroupScreen';
import ProfitLossLedgerVouchersScreen from '../screens/reports/ProfitLossLedgerVouchersScreen';
import BalanceSheetScreen from '../screens/reports/BalanceSheetScreen';
import OutstandingReceivableScreen from '../screens/reports/OutstandingReceivableScreen';
import OutstandingLedgerDetailScreen from '../screens/reports/OutstandingLedgerDetailScreen';
import TopTenReportScreen from '../screens/reports/TopTenReportScreen';
import InactiveCustomerScreen from '../screens/reports/InactiveCustomerScreen';
import InactiveItemScreen from '../screens/reports/InactiveItemScreen';
import CashBankBookScreen from '../screens/reports/CashBankBookScreen';
import CashBankBookLedgersScreen from '../screens/reports/CashBankBookLedgersScreen';
import CashBankBookVouchersScreen from '../screens/reports/CashBankBookVouchersScreen';
import { ReportsStackParamList } from '../types/navigation';
import FastMovingItemsScreen from '../screens/reports/FastMovingItemsScreen';

const Stack = createNativeStackNavigator<ReportsStackParamList>();

const ReportsNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ReportsHome"
        component={PremiumReportsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VouchersList"
        component={VouchersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="ProfitLoss" component={ProfitLossScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ProfitLossGroup"
        component={ProfitLossGroupScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProfitLossLedgerVouchers"
        component={ProfitLossLedgerVouchersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="BalanceSheet" component={BalanceSheetScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="CashBankBook"
        component={CashBankBookScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CashBankBookLedgers"
        component={CashBankBookLedgersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CashBankBookVouchers"
        component={CashBankBookVouchersScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TopTenReport"
        component={TopTenReportScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="FastMovingItems"
        component={FastMovingItemsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OutstandingReceivable"
        component={OutstandingReceivableScreen}
        options={{ headerShown: false }}
      />
      {/* Same screen, different Tally report — selected by the `kind` param. */}
      <Stack.Screen
        name="OutstandingPayable"
        component={OutstandingReceivableScreen}
        initialParams={{ kind: 'payable' }}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OutstandingLedgerDetail"
        component={OutstandingLedgerDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InactiveCustomer"
        component={InactiveCustomerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InactiveItem"
        component={InactiveItemScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
};

export default ReportsNavigator;
