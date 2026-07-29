import React, { useCallback, useEffect, useRef } from 'react';
import { View, ViewProps } from 'react-native';
import { GuideTargetId } from '../../constants/appGuideSteps';
import { useAppGuide } from './AppGuideProvider';

interface GuideTargetProps extends ViewProps {
  targetId: GuideTargetId;
  children: React.ReactNode;
}

const GuideTarget: React.FC<GuideTargetProps> = ({
  targetId,
  children,
  style,
  onLayout,
  ...rest
}) => {
  const { registerTarget, unregisterTarget, reportTargetBounds } = useAppGuide();
  const ref = useRef<View>(null);

  const measureAndReport = useCallback(() => {
    const node = ref.current;
    if (!node) return;

    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        reportTargetBounds(targetId, { x, y, width, height });
      }
    });
  }, [reportTargetBounds, targetId]);

  useEffect(() => {
    registerTarget(targetId, ref, measureAndReport);
    const timer = setTimeout(measureAndReport, 100);
    return () => {
      clearTimeout(timer);
      unregisterTarget(targetId);
    };
  }, [measureAndReport, registerTarget, targetId, unregisterTarget]);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      testID={`guide-${targetId}`}
      onLayout={(event) => {
        onLayout?.(event);
        measureAndReport();
      }}
      {...rest}
    >
      {children}
    </View>
  );
};

export default GuideTarget;
