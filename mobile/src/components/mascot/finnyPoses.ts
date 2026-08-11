/**
 * Finny — TallyFin's finance genie. Semantic pose registry.
 *
 * The rest of the app asks for a *state* ("error", "empty", "working"), never an
 * image file. That indirection is the whole point: replacing the artwork is a
 * change to this file and nothing else.
 */
import type { ImageSourcePropType } from 'react-native';

/**
 * All eleven genie poses are in place, so Finny renders everywhere.
 *
 * Kept as a switch because it is the clean way to suppress the mascot app-wide
 * — during an art refresh, or if a pose ever has to be pulled. Every surface
 * that uses Finny also carries its own text, so `false` degrades to a tidy
 * text-only state rather than leaving a hole.
 */
export const FINNY_ART_READY = true;

/**
 * Source artwork is 1024x1536 (2:3 portrait) with a transparent background.
 * FinnyMascot sizes by height and lets width follow this ratio — treating the
 * art as square would letterbox him into about two-thirds of the box.
 */
export const FINNY_ASPECT_RATIO = 1024 / 1536;

export type FinnyPose =
  | 'welcome'
  | 'intro'
  | 'pointing'
  | 'thinking'
  | 'working'
  | 'success'
  | 'happy'
  | 'empty'
  | 'error'
  | 'help'
  | 'wink';

interface PoseDefinition {
  source: ImageSourcePropType;
  /** Screen-reader description. Finny is decorative, but never unlabelled. */
  label: string;
  /** Purpose-drawn art rather than a stand-in. All eleven now are. */
  exact: boolean;
}

export const FINNY_POSES: Record<FinnyPose, PoseDefinition> = {
  welcome: {
    source: require('../../assets/mascot/finny-welcome.png'),
    label: 'Finny waving hello',
    exact: true,
  },
  intro: {
    source: require('../../assets/mascot/finny-intro.png'),
    label: 'Finny introducing TallyFin',
    exact: true,
  },
  pointing: {
    source: require('../../assets/mascot/finny-pointing.png'),
    label: 'Finny pointing something out',
    exact: true,
  },
  thinking: {
    source: require('../../assets/mascot/finny-thinking.png'),
    label: 'Finny thinking',
    exact: true,
  },
  working: {
    source: require('../../assets/mascot/finny-working.png'),
    label: 'Finny fetching your data',
    exact: true,
  },
  success: {
    source: require('../../assets/mascot/finny-success.png'),
    label: 'Finny celebrating',
    exact: true,
  },
  happy: {
    source: require('../../assets/mascot/finny-happy.png'),
    label: 'Finny giving a thumbs up',
    exact: true,
  },
  empty: {
    source: require('../../assets/mascot/finny-empty.png'),
    label: 'Finny looking for data',
    exact: true,
  },
  error: {
    source: require('../../assets/mascot/finny-error.png'),
    label: 'Finny noticing a problem',
    exact: true,
  },
  help: {
    source: require('../../assets/mascot/finny-help.png'),
    label: 'Finny offering help',
    exact: true,
  },
  wink: {
    source: require('../../assets/mascot/finny-wink.png'),
    label: 'Finny winking',
    exact: true,
  },
};

/**
 * Poses still riding on stand-in artwork — empty now that all eleven have been
 * drawn. If this ever repopulates, it is the commission list.
 */
export const PENDING_POSE_ART: FinnyPose[] = (
  Object.keys(FINNY_POSES) as FinnyPose[]
).filter((p) => !FINNY_POSES[p].exact);

/**
 * Sizes are named, not numeric, so "how big is Finny here" stays a product
 * decision rather than a per-screen guess. The number is his **height**.
 *
 *  xl — App Tour intro/outro, onboarding
 *  lg — full-screen empty states
 *  md — success / sync / informational cards
 *  sm — inline tips, list empty states
 *  xs — avatar next to a line of text, help button
 */
export type FinnySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const FINNY_SIZES: Record<FinnySize, number> = {
  xs: 36,
  sm: 64,
  md: 96,
  lg: 140,
  xl: 184,
};
