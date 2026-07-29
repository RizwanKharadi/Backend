import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { InteractionManager, StyleSheet, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import {
  APP_GUIDE_STEPS,
  GuideTargetId,
} from '../../constants/appGuideSteps';
import { AppDispatch, RootState } from '../../store';
import {
  resetAppGuide,
  setAppGuideCompleted,
} from '../../store/slices/settingsSlice';
import AppGuideOverlay, { SpotlightRect } from './AppGuideOverlay';

type MeasureFn = () => void;

interface RegisteredTarget {
  ref: React.RefObject<View>;
  measure: MeasureFn;
}

interface AppGuideContextValue {
  registerTarget: (
    id: GuideTargetId,
    ref: React.RefObject<View>,
    measure: MeasureFn
  ) => void;
  unregisterTarget: (id: GuideTargetId) => void;
  reportTargetBounds: (id: GuideTargetId, bounds: SpotlightRect) => void;
  startGuide: () => void;
  isActive: boolean;
}

const AppGuideContext = createContext<AppGuideContextValue | null>(null);

export const useAppGuide = (): AppGuideContextValue => {
  const ctx = useContext(AppGuideContext);
  if (!ctx) {
    throw new Error('useAppGuide must be used within AppGuideProvider');
  }
  return ctx;
};

interface AppGuideProviderProps {
  children: React.ReactNode;
  autoStart?: boolean;
}

const measureTarget = (ref: React.RefObject<View>): Promise<SpotlightRect | null> =>
  new Promise((resolve) => {
    const node = ref.current;
    if (!node) {
      resolve(null);
      return;
    }

    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          resolve(null);
          return;
        }
        resolve({ x, y, width, height });
      });
    });
  });

export const AppGuideProvider: React.FC<AppGuideProviderProps> = ({
  children,
  autoStart = false,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const hasSeenAppGuide = useSelector(
    (s: RootState) => s.settings.hasSeenAppGuide ?? false
  );

  const targetsRef = useRef<Map<GuideTargetId, RegisteredTarget>>(new Map());
  const boundsRef = useRef<Map<GuideTargetId, SpotlightRect>>(new Map());
  const autoStartAttemptedRef = useRef(false);

  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

  const currentStep = APP_GUIDE_STEPS[stepIndex];

  const registerTarget = useCallback(
    (id: GuideTargetId, ref: React.RefObject<View>, measure: MeasureFn) => {
      targetsRef.current.set(id, { ref, measure });
    },
    []
  );

  const unregisterTarget = useCallback((id: GuideTargetId) => {
    targetsRef.current.delete(id);
    boundsRef.current.delete(id);
  }, []);

  const reportTargetBounds = useCallback((id: GuideTargetId, bounds: SpotlightRect) => {
    boundsRef.current.set(id, bounds);
  }, []);

  const remeasureTarget = useCallback(async (id: GuideTargetId): Promise<SpotlightRect | null> => {
    const registered = targetsRef.current.get(id);
    if (!registered) {
      return boundsRef.current.get(id) ?? null;
    }

    registered.measure();
    const measured = await measureTarget(registered.ref);
    if (measured) {
      boundsRef.current.set(id, measured);
      return measured;
    }

    return boundsRef.current.get(id) ?? null;
  }, []);

  const completeGuide = useCallback(() => {
    setIsActive(false);
    setStepIndex(0);
    setSpotlight(null);
    dispatch(setAppGuideCompleted());
  }, [dispatch]);

  const refreshSpotlight = useCallback(
    async (index: number) => {
      const step = APP_GUIDE_STEPS[index];
      if (step.fullScreen || !step.targetId) {
        setSpotlight(null);
        return;
      }

      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });

      let rect: SpotlightRect | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        rect = await remeasureTarget(step.targetId);
        if (rect) break;
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
      }

      setSpotlight(rect);
    },
    [remeasureTarget]
  );

  const startGuide = useCallback(() => {
    setStepIndex(0);
    setIsActive(true);
  }, []);

  const goNext = useCallback(() => {
    if (stepIndex >= APP_GUIDE_STEPS.length - 1) {
      completeGuide();
      return;
    }
    setStepIndex(stepIndex + 1);
  }, [completeGuide, stepIndex]);

  const skipGuide = useCallback(() => {
    completeGuide();
  }, [completeGuide]);

  useEffect(() => {
    if (!isActive) return undefined;
    const timer = setTimeout(() => {
      void refreshSpotlight(stepIndex);
    }, 200);
    return () => clearTimeout(timer);
  }, [isActive, refreshSpotlight, stepIndex]);

  useEffect(() => {
    if (!autoStart || hasSeenAppGuide || autoStartAttemptedRef.current) {
      return undefined;
    }
    autoStartAttemptedRef.current = true;
    const timer = setTimeout(() => {
      startGuide();
    }, 600);
    return () => clearTimeout(timer);
  }, [autoStart, hasSeenAppGuide, startGuide]);

  const contextValue = useMemo(
    () => ({
      registerTarget,
      unregisterTarget,
      reportTargetBounds,
      startGuide,
      isActive,
    }),
    [isActive, registerTarget, reportTargetBounds, startGuide, unregisterTarget]
  );

  return (
    <AppGuideContext.Provider value={contextValue}>
      <View style={styles.container}>
        {children}
        {isActive && currentStep ? (
          <AppGuideOverlay
            visible={isActive}
            step={currentStep}
            stepIndex={stepIndex}
            totalSteps={APP_GUIDE_STEPS.length}
            spotlight={spotlight}
            onNext={goNext}
            onSkip={skipGuide}
          />
        ) : null}
      </View>
    </AppGuideContext.Provider>
  );
};

/** Resets persisted flag and starts the tour (used from Settings). */
export const replayAppGuide = (dispatch: AppDispatch, startGuide: () => void) => {
  dispatch(resetAppGuide());
  setTimeout(() => startGuide(), 300);
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default AppGuideProvider;
