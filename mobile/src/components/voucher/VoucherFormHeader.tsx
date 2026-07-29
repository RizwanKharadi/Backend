import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { Appbar, IconButton } from 'react-native-paper';

interface VoucherFormHeaderProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
}

const HEADER_BG = '#1E6FD9';

const VoucherFormHeader: React.FC<VoucherFormHeaderProps> = ({
  title,
  subtitle,
  onBack,
  rightIcon,
  onRightPress,
}) => {
  return (
    <View style={styles.wrap}>
      <StatusBar backgroundColor={HEADER_BG} barStyle="light-content" />
      <Appbar.Header style={[styles.header, { backgroundColor: HEADER_BG }]}>
        <Appbar.BackAction onPress={onBack} color="#fff" />
        <Appbar.Content
          title={title}
          subtitle={subtitle}
          titleStyle={styles.title}
          subtitleStyle={styles.subtitle}
          color="#fff"
        />
        {rightIcon ? (
          <IconButton icon={rightIcon} iconColor="#fff" onPress={onRightPress} />
        ) : null}
      </Appbar.Header>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: HEADER_BG,
  },
  header: {
    elevation: 0,
  },
  title: {
    fontWeight: '600',
    fontSize: 18,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    marginTop: -2,
  },
});

export default VoucherFormHeader;
