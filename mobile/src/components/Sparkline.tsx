/**
 * Sparkline — shared mini area+line chart (react-native-svg). Renders nothing
 * when there are fewer than 2 points so we never draw a fake trend.
 */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  /** Unique id for the gradient fill (must be unique per rendered instance). */
  gradientId: string;
}

function buildPaths(values: number[], w: number, h: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 4;
  const stepX = w / (values.length - 1);
  const points = values.map((v, i) => ({
    x: i * stepX,
    y: padY + (h - padY * 2) * (1 - (v - min) / range),
  }));

  let line = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    line += ` Q${prev.x},${prev.y} ${midX},${(prev.y + cur.y) / 2}`;
    line += ` T${cur.x},${cur.y}`;
  }
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

const Sparkline: React.FC<SparklineProps> = ({
  values,
  color,
  width = 150,
  height = 40,
  gradientId,
}) => {
  const paths = useMemo(
    () => (values.length >= 2 ? buildPaths(values, width, height) : null),
    [values, width, height]
  );

  if (!paths) {
    return <View style={{ height }} />;
  }

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={paths.area} fill={`url(#${gradientId})`} />
      <Path d={paths.line} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
};

export default React.memo(Sparkline);
