/**
 * Site configuration — edit before publishing.
 * No backend calls; download URL points to your hosted installer.
 */
window.TALLYFIN_CONFIG = {
  contactEmail: 'support@tallyfin.com',
  contactPhone: '+91 00000 00000',
  contactAddress: 'India',

  /** Place TallyFin-Desktop-Agent-Setup.exe in website/downloads/ */
  agentDownloadUrl: 'downloads/TallyFin-Desktop-Agent-Setup.exe',
  agentVersion: '1.0.3',
  agentFileSize: '~85 MB',

  /** Google Play link when published */
  playStoreUrl: '#',
  appStoreUrl: '#',

  pricing: {
    trialDays: 7,
    monthlyInr: 999,
    yearlyInr: 9999,
    currency: 'INR',
    gstNote: '18% GST applicable. Mobile app included with every device license.'
  }
};
