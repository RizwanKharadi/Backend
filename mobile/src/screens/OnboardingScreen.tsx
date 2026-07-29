import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  FlatList,
  StatusBar,
  ViewToken,
} from 'react-native';
import {
  Text,
  Button,
  useTheme,
  Surface,
} from 'react-native-paper';
import { useDispatch } from 'react-redux';

// Store
import { AppDispatch } from '../store';
import { setFirstLaunchCompleted } from '../store/slices/settingsSlice';

// Components
import FinnyMascot from '../components/guide/FinnyMascot';

// Types
import { MascotPose } from '../constants/appGuideSteps';
import { RootStackScreenProps } from '../types/navigation';

const { width } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  mascotPose: MascotPose;
  tint: string;
}

const slides: OnboardingSlide[] = [
  {
    id: '1',
    eyebrow: 'Meet Finny',
    title: 'Hi! I\'m Finny, your TallyFin guide',
    description: 'TallyFin keeps your numbers, reports, and activity in sync across desktop and mobile.',
    mascotPose: 'welcome',
    tint: '#1B8A3E',
  },
  {
    id: '2',
    eyebrow: 'Offline Ready',
    title: 'Keep working even without internet',
    description: 'Changes are stored locally and synced automatically when your network is back.',
    mascotPose: 'pointing',
    tint: '#39B54A',
  },
  {
    id: '3',
    eyebrow: 'Live Sync',
    title: 'Desktop agent + mobile always aligned',
    description: 'When TallyPrime and desktop-agent run on your PC, mobile data stays fresh and up to date.',
    mascotPose: 'pointing',
    tint: '#0b3f7a',
  },
  {
    id: '4',
    eyebrow: 'You\'re all set',
    title: 'Business data protected by design',
    description: 'JWT auth, biometric login, and encrypted storage keep your account and data safe.',
    mascotPose: 'celebrate',
    tint: '#002147',
  },
];

type Props = RootStackScreenProps<'Onboarding'>;

const OnboardingScreen: React.FC<Props> = () => {
  const theme = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const flatListRef = useRef<FlatList>(null);
  
  const [currentIndex, setCurrentIndex] = useState(0);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index || 0);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      handleGetStarted();
    }
  };

  const handleSkip = () => {
    handleGetStarted();
  };

  const handleGetStarted = () => {
    dispatch(setFirstLaunchCompleted());
    // Navigation will be handled by AppNavigator based on auth state
  };

  const renderSlide = ({ item }: { item: OnboardingSlide }) => (
    <View style={[styles.slide, { width }]}>
      <View style={styles.slideContent}>
        <View style={styles.heroCard}>
          <View style={[styles.mascotContainer, { backgroundColor: `${item.tint}12` }]}>
            <FinnyMascot pose={item.mascotPose} size={currentIndex === 0 ? 180 : 150} />
          </View>
          <Text
            variant="labelLarge"
            style={[styles.eyebrow, { color: item.tint }]}
          >
            {item.eyebrow}
          </Text>
          <Text
            variant="headlineMedium"
            style={[styles.title, { color: theme.colors.onSurface }]}
          >
            {item.title}
          </Text>
          <Text
            variant="bodyLarge"
            style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
          >
            {item.description}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderPagination = () => (
    <View style={styles.pagination}>
      {slides.map((_, index) => (
        <View
          key={index}
          style={[
            styles.paginationDot,
            {
              backgroundColor: index === currentIndex 
                ? theme.colors.primary 
                : theme.colors.outline,
              width: index === currentIndex ? 24 : 8,
            },
          ]}
        />
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.bgHeader} />
      <View style={styles.bgAccent} />

      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />
      
      {renderPagination()}
      
      <Surface style={[styles.footer, { backgroundColor: theme.colors.surface }]} elevation={2}>
        <View style={styles.footerContent}>
          {currentIndex < slides.length - 1 ? (
            <>
              <Button
                mode="text"
                onPress={handleSkip}
                style={styles.skipButton}
              >
                Skip
              </Button>
              
              <Button
                mode="contained"
                onPress={handleNext}
                style={styles.nextButton}
                icon="arrow-right"
                contentStyle={styles.nextButtonContent}
                buttonColor="#002147"
              >
                Next
              </Button>
            </>
          ) : (
            <Button
              mode="contained"
              onPress={handleGetStarted}
              style={styles.getStartedButton}
              contentStyle={styles.getStartedButtonContent}
              buttonColor="#002147"
            >
              Get Started
            </Button>
          )}
        </View>
      </Surface>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bgHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: '#002147',
  },
  bgAccent: {
    position: 'absolute',
    top: 210,
    right: -120,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(57, 181, 74, 0.16)',
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 120,
    width: '100%',
  },
  heroCard: {
    width: '100%',
    borderRadius: 26,
    backgroundColor: '#ffffff',
    paddingHorizontal: 24,
    paddingVertical: 34,
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  mascotContainer: {
    width: 200,
    height: 200,
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '700',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 25,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    gap: 8,
  },
  paginationDot: {
    height: 8,
    borderRadius: 4,
    transition: 'all 0.3s ease',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 16,
    paddingBottom: 34,
    paddingHorizontal: 20,
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipButton: {
    flex: 1,
    borderColor: '#cbd5e1',
  },
  nextButton: {
    flex: 1,
    marginLeft: 16,
  },
  nextButtonContent: {
    height: 48,
    flexDirection: 'row-reverse',
  },
  getStartedButton: {
    flex: 1,
  },
  getStartedButtonContent: {
    height: 48,
  },
});

export default OnboardingScreen;
