import { NavigationProp } from '@react-navigation/native';
import { MainTabParamList, ReportsStackParamList } from '../types/navigation';

interface ReportNavOptions {
  /**
   * Set when opening a report from outside the Reports tab (e.g. a dashboard
   * tile). The report becomes the only route in the Reports stack, so Back has
   * nothing to pop there and falls through to the tab navigator, which returns
   * to the tab you came from (Tab.Navigator uses backBehavior="history").
   *
   * Left unset, ReportsHome stays underneath and Back returns to the reports
   * list — correct when the user actually came from that list.
   */
  standalone?: boolean;
}

/**
 * Switch bottom tab from a screen that draws its own tab bar (the premium
 * Dashboard / Transactions / Inventory screens hide the real one, so the
 * tabPress listener in MainNavigator never fires for them).
 *
 * Reports is special-cased: it owns a nested stack, and a report opened from a
 * dashboard tile sits in it alone. Without naming ReportsHome the tab would
 * reopen that report instead of the reports list.
 */
export function navigateToTab(
  navigation: NavigationProp<MainTabParamList>,
  route: string
) {
  if (route === 'Reports') {
    navigation.navigate('Reports', { screen: 'ReportsHome' });
    return;
  }
  (navigation as NavigationProp<Record<string, undefined>>).navigate(route);
}

export function navigateToReportTab<S extends keyof ReportsStackParamList>(
  navigation: NavigationProp<MainTabParamList>,
  screen: S,
  params?: ReportsStackParamList[S],
  options?: ReportNavOptions
) {
  if (options?.standalone) {
    // Replace the Reports stack outright rather than pushing onto it.
    // `navigate({ screen })` pushes onto whatever is already there, so opening
    // Payables and then Bank Balance from the dashboard left [Payables, Bank]
    // and Back showed Payables. Handing over a full nested state makes the
    // chosen report the only route every time, so Back falls through to the
    // tab navigator and lands on the dashboard.
    navigation.navigate('Reports', {
      state: { index: 0, routes: [{ name: screen, params }] },
    } as never);
    return;
  }

  navigation.navigate('Reports', { screen, params, initial: false });
}
