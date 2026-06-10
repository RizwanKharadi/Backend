import {
  normalizeTallySerial,
  maskEmail,
  mapTallyLicensePayload
} from '../src/services/tallySerialService.js';

describe('tallySerialService', () => {
  test('normalizeTallySerial trims and uppercases', () => {
    expect(normalizeTallySerial(' 725452839 ')).toBe('725452839');
  });

  test('maskEmail hides local part', () => {
    expect(maskEmail('rizwan@example.com')).toMatch(/ri\*\*\*@example\.com/);
  });

  test('mapTallyLicensePayload requires serial', () => {
    expect(mapTallyLicensePayload({ planName: 'Gold' })).toBeNull();
    expect(mapTallyLicensePayload({ serialNumber: '12345' })?.serialNumber).toBe('12345');
  });
});
