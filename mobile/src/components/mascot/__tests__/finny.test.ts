import {
  FINNY_ART_READY,
  FINNY_POSES,
  FINNY_SIZES,
  PENDING_POSE_ART,
  type FinnyPose,
} from '../finnyPoses';
import { APP_GUIDE_STEPS, TALLYFIN_TAGLINE } from '../../../constants/appGuideSteps';

describe('Finny pose registry', () => {
  const poses = Object.keys(FINNY_POSES) as FinnyPose[];

  it('covers all eleven specified states', () => {
    expect(poses.sort()).toEqual(
      [
        'empty',
        'error',
        'happy',
        'help',
        'intro',
        'pointing',
        'success',
        'thinking',
        'welcome',
        'wink',
        'working',
      ].sort()
    );
  });

  it('gives every pose artwork and a screen-reader label', () => {
    for (const pose of poses) {
      expect(FINNY_POSES[pose].source).toBeTruthy();
      expect(FINNY_POSES[pose].label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has purpose-drawn artwork for every pose', () => {
    // All eleven genie renders were delivered, so nothing is on a stand-in.
    // If this fails, a pose was added without art — check PENDING_POSE_ART.
    expect(PENDING_POSE_ART).toEqual([]);
    for (const pose of poses) expect(FINNY_POSES[pose].exact).toBe(true);
  });

  it('uses a distinct image for every pose', () => {
    // Guards against a copy-paste that points two states at the same render —
    // which is how the app ends up silently showing the wrong Finny.
    const sources = poses.map((p) => FINNY_POSES[p].source);
    expect(new Set(sources).size).toBe(poses.length);
  });

  it('is switched on', () => {
    expect(FINNY_ART_READY).toBe(true);
  });

  it('orders the named sizes smallest to largest', () => {
    const order = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
    const values = order.map((k) => FINNY_SIZES[k]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('App Tour', () => {
  it('has the six specified screens in order', () => {
    expect(APP_GUIDE_STEPS.map((s) => s.id)).toEqual([
      'welcome',
      'company-picker',
      'dashboard',
      'bottom-nav',
      'language',
      'done',
    ]);
  });

  it('uses the exact brand copy', () => {
    expect(APP_GUIDE_STEPS[0].title).toBe('Welcome to TallyFin');
    expect(APP_GUIDE_STEPS[1].title).toBe('Switch Companies Easily');
    expect(APP_GUIDE_STEPS[2].title).toBe('Your Business at a Glance');
    expect(APP_GUIDE_STEPS[3].title).toBe('Everything Within Reach');
    expect(APP_GUIDE_STEPS[4].title).toBe('Choose Your Language');
    expect(APP_GUIDE_STEPS[5].title).toBe('Ready to Get Started?');
    expect(APP_GUIDE_STEPS[5].ctaLabel).toBe('Get Started');
  });

  it('keeps the tagline as "Har Hisaab Aasan Hai" on intro and outro only', () => {
    expect(TALLYFIN_TAGLINE).toBe('Har Hisaab Aasan Hai');
    const tagged = APP_GUIDE_STEPS.filter((s) => s.showTagline).map((s) => s.id);
    expect(tagged).toEqual(['welcome', 'done']);
  });

  it('never uses the retired "Business Mera On The Go" line', () => {
    const allCopy = JSON.stringify(APP_GUIDE_STEPS) + TALLYFIN_TAGLINE;
    expect(allCopy).not.toMatch(/Business Mera On The Go/i);
  });

  it('spotlights a target on every step except the intro and outro', () => {
    for (const step of APP_GUIDE_STEPS) {
      if (step.fullScreen) expect(step.targetId).toBeUndefined();
      else expect(step.targetId).toBeTruthy();
    }
  });

  it('uses a pose that exists for every step', () => {
    for (const step of APP_GUIDE_STEPS) {
      expect(FINNY_POSES[step.mascotPose]).toBeDefined();
    }
  });
});
