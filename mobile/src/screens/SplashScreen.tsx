import React, { useEffect } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Text, useTheme, ActivityIndicator } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Services
import { initializeServices } from '../services';

const BRAND = {
  deepBlue: '#002147',
  royalBlue: '#0b3f7a',
  emerald: '#1B8A3E',
  neonGreen: '#39B54A',
};

const SplashScreen: React.FC = () => {
  const theme = useTheme();

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    // Start animations
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 45,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Initialize app
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize services
      await initializeServices();
      
      // Note: We don't call navigation.replace here anymore.
      // The AppNavigator will automatically switch screens once the 
      // initialization is complete and Redux state updates.
      console.log('Services initialized from SplashScreen');
    } catch (error) {
      console.error('App initialization failed in SplashScreen:', error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: BRAND.deepBlue }]}>
      <View style={[styles.bgCircle, styles.bgCircleOne]} />
      <View style={[styles.bgCircle, styles.bgCircleTwo]} />
      <View style={[styles.bgCircle, styles.bgCircleThree]} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <View style={styles.logoContainer}>
          <View style={styles.brandRing}>
            <Icon name="swap-horizontal-bold" size={58} color={BRAND.neonGreen} />
          </View>
          <Text
            variant="headlineLarge"
            style={[styles.appName, { color: theme.colors.onPrimary }]}
          >
            TallyFin
          </Text>
          <Text
            variant="bodyLarge"
            style={[styles.tagline, { color: theme.colors.onPrimary }]}
          >
            Smart ERP sync for growing businesses
          </Text>
        </View>

        <View style={styles.loadingCard}>
          <ActivityIndicator size="small" color={BRAND.neonGreen} />
          <Text
            variant="bodyMedium"
            style={[styles.loadingText, { color: theme.colors.onPrimary }]}
          >
            Initializing your workspace...
          </Text>
        </View>
      </Animated.View>

      <View style={styles.footer}>
        <Text
          variant="bodySmall"
          style={[styles.version, { color: theme.colors.onPrimary }]}
        >
          Version 1.0.0
        </Text>
        <Text
          variant="bodySmall"
          style={[styles.copyright, { color: theme.colors.onPrimary }]}
        >
          © 2026 TallyFin
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  bgCircle: {
    position: 'absolute',
    borderRadius: 999,
  },
  bgCircleOne: {
    width: 280,
    height: 280,
    top: -120,
    right: -70,
    backgroundColor: BRAND.royalBlue,
    opacity: 0.6,
  },
  bgCircleTwo: {
    width: 210,
    height: 210,
    bottom: 110,
    left: -90,
    backgroundColor: BRAND.emerald,
    opacity: 0.35,
  },
  bgCircleThree: {
    width: 120,
    height: 120,
    bottom: -30,
    right: 40,
    backgroundColor: BRAND.neonGreen,
    opacity: 0.22,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  brandRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  appName: {
    marginTop: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  tagline: {
    marginTop: 8,
    textAlign: 'center',
    opacity: 0.85,
  },
  loadingCard: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 10,
    opacity: 0.8,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
  },
  version: {
    opacity: 0.7,
    marginBottom: 4,
  },
  copyright: {
    opacity: 0.7,
  },
});

export default SplashScreen;
