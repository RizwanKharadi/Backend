import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';

interface LoadingSpinnerProps {
  size?: 'small' | 'large' | number;
  color?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'large',
  color
}) => {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ActivityIndicator
        animating={true}
        size={size}
        color={color || theme.colors.primary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default LoadingSpinner;