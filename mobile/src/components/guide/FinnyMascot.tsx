import React from 'react';
import { Image, ImageSourcePropType, StyleSheet, View } from 'react-native';
import { MascotPose } from '../../constants/appGuideSteps';

const POSE_IMAGES: Record<MascotPose, ImageSourcePropType> = {
  welcome: require('../../assets/mascot/finny-welcome.png'),
  pointing: require('../../assets/mascot/finny-pointing.png'),
  celebrate: require('../../assets/mascot/finny-celebrate.png'),
};

interface FinnyMascotProps {
  pose: MascotPose;
  size?: number;
}

const FinnyMascot: React.FC<FinnyMascotProps> = ({ pose, size = 120 }) => (
  <View style={[styles.wrapper, { width: size, height: size }]}>
    <Image
      source={POSE_IMAGES[pose]}
      style={styles.image}
      resizeMode="contain"
      accessibilityLabel={`Finny mascot, ${pose} pose`}
    />
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

export default FinnyMascot;
