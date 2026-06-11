import { NavigationProp } from '@react-navigation/native';
import { MainTabParamList, ReportsStackParamList } from '../types/navigation';

export function navigateToReportTab<S extends keyof ReportsStackParamList>(
  navigation: NavigationProp<MainTabParamList>,
  screen: S,
  params?: ReportsStackParamList[S]
) {
  navigation.navigate('Reports', {
    screen,
    params,
    initial: false,
  });
}
