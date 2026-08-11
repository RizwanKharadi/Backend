import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { RNCamera } from 'react-native-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MainStackScreenProps } from '../types/navigation';
import { useTranslation } from 'react-i18next';

type Props = MainStackScreenProps<'BarcodeScanner'>;

const BarcodeScannerScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { onScanned, title } = route.params;
  const [lastValue, setLastValue] = useState<string>('');
  const busyRef = useRef(false);

  const handleRead = useCallback(
    (event: any) => {
      const value: string = String(event?.data || '').trim();
      if (!value) return;
      if (busyRef.current) return;
      if (value === lastValue) return;

      busyRef.current = true;
      setLastValue(value);

      try {
        onScanned(value);
      } finally {
        navigation.goBack();
        // allow another scan next time screen opens
        setTimeout(() => {
          busyRef.current = false;
        }, 600);
      }
    },
    [lastValue, navigation, onScanned]
  );

  return (
    <View style={styles.container}>
      <RNCamera
        style={styles.camera}
        type={RNCamera.Constants.Type.back}
        captureAudio={false}
        onBarCodeRead={handleRead}
        barCodeTypes={[
          RNCamera.Constants.BarCodeType.ean13,
          RNCamera.Constants.BarCodeType.ean8,
          RNCamera.Constants.BarCodeType.code128,
          RNCamera.Constants.BarCodeType.code39,
          RNCamera.Constants.BarCodeType.upca,
          RNCamera.Constants.BarCodeType.upce,
          RNCamera.Constants.BarCodeType.qr,
        ]}
        androidCameraPermissionOptions={{
          title: 'Camera permission',
          message: 'We need camera access to scan barcodes.',
          buttonPositive: 'OK',
          buttonNegative: 'Cancel',
        }}
      >
        <View pointerEvents="none" style={styles.frameWrap}>
          <View style={styles.frame} />
          <View style={styles.laser} />
        </View>
      </RNCamera>

      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.topBtn} hitSlop={10}>
          <Icon name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>{title || 'Scan barcode'}</Text>
        <View style={styles.topBtn} />
      </View>

      <View style={styles.hintWrap}>
        <Text style={styles.hintText}>{t('scanner.alignBarcode')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  frameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: '78%',
    maxWidth: 320,
    aspectRatio: 1.6,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  laser: {
    position: 'absolute',
    width: '78%',
    maxWidth: 320,
    height: 2,
    backgroundColor: '#22c55e',
    opacity: 0.9,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: 'center',
  },
  hintText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
});

export default BarcodeScannerScreen;

