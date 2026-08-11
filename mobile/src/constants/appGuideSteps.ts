/**
 * The Finny-guided App Tour.
 *
 * ENGLISH ONLY, deliberately. The tour copy is brand voice — it is not routed
 * through i18n and must not be translated. The single non-English string is the
 * TallyFin tagline "Har Hisaab Aasan Hai", which is a brand asset rather than
 * translatable text. See docs/I18N.md.
 */
import type { FinnyPose } from '../components/mascot/finnyPoses';

export type GuideTargetId =
  | 'company-picker'
  | 'dashboard'
  | 'bottom-nav'
  | 'language-switcher'
  | 'tab-bar'
  | 'settings-button'
  | 'sync-button'
  | 'create-voucher';

/** Kept for the existing FinnyMascot import path; poses now live with the mascot. */
export type MascotPose = FinnyPose;

/** The primary TallyFin tagline. Never replace this with another line. */
export const TALLYFIN_TAGLINE = 'Har Hisaab Aasan Hai';

export interface AppGuideStep {
  id: string;
  title: string;
  body: string;
  mascotPose: FinnyPose;
  targetId?: GuideTargetId;
  /** Full-screen intro/outro without a spotlight target. */
  fullScreen?: boolean;
  /** Show the brand tagline under the body — intro and outro only. */
  showTagline?: boolean;
  /** Overrides the default "Next" label. */
  ctaLabel?: string;
}

export const APP_GUIDE_STEPS: AppGuideStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to TallyFin',
    body: 'Your smart business companion for managing your business information on the go.',
    mascotPose: 'welcome',
    fullScreen: true,
    showTagline: true,
  },
  {
    id: 'company-picker',
    title: 'Switch Companies Easily',
    body: 'Manage multiple companies and quickly switch between them whenever you need.',
    mascotPose: 'pointing',
    targetId: 'company-picker',
  },
  {
    id: 'dashboard',
    title: 'Your Business at a Glance',
    body: 'View your key business information, insights and important figures from one simple dashboard.',
    mascotPose: 'pointing',
    targetId: 'dashboard',
  },
  {
    id: 'bottom-nav',
    title: 'Everything Within Reach',
    body: 'Quickly access your main sections and move around TallyFin using the bottom navigation.',
    mascotPose: 'pointing',
    targetId: 'bottom-nav',
  },
  {
    id: 'language',
    title: 'Choose Your Language',
    body: "Use TallyFin in the language you're most comfortable with.",
    mascotPose: 'pointing',
    targetId: 'language-switcher',
  },
  {
    id: 'done',
    title: 'Ready to Get Started?',
    body: 'Manage your business with confidence, wherever you are.',
    mascotPose: 'success',
    fullScreen: true,
    showTagline: true,
    ctaLabel: 'Get Started',
  },
];
