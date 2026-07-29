export type GuideTargetId =
  | 'company-picker'
  | 'tab-bar'
  | 'settings-button'
  | 'sync-button'
  | 'create-voucher';

export type MascotPose = 'welcome' | 'pointing' | 'celebrate';

export interface AppGuideStep {
  id: string;
  title: string;
  body: string;
  mascotPose: MascotPose;
  targetId?: GuideTargetId;
  /** Full-screen intro/outro without a spotlight target */
  fullScreen?: boolean;
}

export const APP_GUIDE_STEPS: AppGuideStep[] = [
  {
    id: 'welcome',
    title: 'Hi, I\'m Finny!',
    body: 'Let me show you around TallyFin — your mobile window into Tally data synced from your desktop.',
    mascotPose: 'welcome',
    fullScreen: true,
  },
  {
    id: 'company-picker',
    title: 'Choose your company',
    body: 'Tap here to select the Tally company synced from your desktop-agent on your PC.',
    mascotPose: 'pointing',
    targetId: 'company-picker',
  },
  {
    id: 'tab-bar',
    title: 'Main navigation',
    body: 'Use these tabs for Dashboard, Transactions, Inventory, Reports, and Chat.',
    mascotPose: 'pointing',
    targetId: 'tab-bar',
  },
  {
    id: 'settings',
    title: 'Settings',
    body: 'Billing, sync options, profile, and app preferences live here.',
    mascotPose: 'pointing',
    targetId: 'settings-button',
  },
  {
    id: 'create-voucher',
    title: 'Create voucher',
    body: 'Tap here to quickly add a new voucher and keep your books updated on the go.',
    mascotPose: 'pointing',
    targetId: 'create-voucher',
  },
  {
    id: 'done',
    title: 'You\'re all set!',
    body: 'Make sure TallyPrime and desktop-agent are running on your PC, then explore your synced data.',
    mascotPose: 'celebrate',
    fullScreen: true,
  },
];
