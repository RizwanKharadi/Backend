/**
 * The real module builds a NativeEventEmitter at import time, which throws
 * under jest because there is no native module to attach to. Only the few
 * getters deviceIdentity uses need to exist here.
 */
module.exports = {
  getBrand: () => 'TestBrand',
  getDeviceName: () => Promise.resolve('Test Device'),
  getVersion: () => '1.0.0',
  getSystemName: () => 'TestOS',
  getUniqueId: () => Promise.resolve('test-unique-id'),
};
