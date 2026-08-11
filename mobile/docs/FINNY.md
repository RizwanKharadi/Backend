# Finny — the TallyFin mascot system

> **Artwork status: complete.** All eleven genie poses are in
> `assets/mascot/` at 1024×1536 with transparent backgrounds, and
> `FINNY_ART_READY` is `true`. The prompts that produced them are kept in
> `docs/FINNY-ART-BRIEF.md` for future poses or a restyle.

Finny is TallyFin's finance genie: a friendly, professional companion, not
decoration. He shows up where a user is waiting, stuck, or being congratulated —
and stays out of the way everywhere else.

**The primary tagline is `Har Hisaab Aasan Hai`.** It is a brand asset, never
translated, and never replaced. "Business Mera On The Go" is retired; a test
fails if it reappears in tour copy.

## Using Finny

```tsx
import { FinnyMascot, FinnyState } from '../components/mascot';

<FinnyMascot pose="working" size="md" animation="float" decorative />

<FinnyState
  variant="empty"
  title="No entries"
  message="Try changing the date or filter."
/>
```

Nothing outside `components/mascot/` should `require()` a mascot PNG. Screens ask
for a **semantic pose**, never a file — that indirection is why new artwork is a
one-file change.

### Poses

Eleven semantic states live in `finnyPoses.ts`, each with its own purpose-drawn
render: `welcome`, `intro`, `pointing`, `thinking`, `working`, `success`,
`happy`, `empty`, `error`, `help`, `wink`.

`PENDING_POSE_ART` lists any pose still on a stand-in — currently empty. To swap
artwork: drop the PNG in `assets/mascot/`, point `source` at it. No screen
changes. Tests assert every pose has art, that `PENDING_POSE_ART` stays empty,
and that **no two poses share the same image** — the last one guards against a
copy-paste that would silently show the wrong Finny.

### Sizes and aspect ratio

The source art is **1024×1536 (2:3 portrait)**, so `FINNY_SIZES` values are a
**height**; width is derived from `FINNY_ASPECT_RATIO`. Sizing Finny into a
square box would letterbox him into about two-thirds of it.

`xl` 184 App Tour intro/outro · `lg` 140 full-screen empty states · `md` 96
success, sync, info cards · `sm` 64 inline tips · `xs` 36 avatar beside text.

### The kill switch

`FINNY_ART_READY` in `finnyPoses.ts` suppresses the mascot app-wide when
`false` — for an art refresh, or if a pose has to be pulled. Every surface that
uses Finny also carries its own text, so it degrades to a tidy text-only state
rather than leaving a hole.

### Animation

Deliberately restrained — Finny is a business companion, not a spinner.

- `float` — slow 2.2s drift, the default
- `wave` — float plus a tilt every ~2s, not continuous
- `celebrate` — a single spring on mount, not a loop
- `none` — used on the error boundary; a bouncing mascot after a crash is
  tone-deaf

All motion **stops when the OS reports reduce-motion**, and animations are
cancelled on unmount so a backgrounded screen isn't animating.

## Where Finny appears

| Surface | Pose | Size |
|---|---|---|
| App Tour intro | `welcome` (wave) | xl |
| App Tour steps | `pointing` (float) | md |
| App Tour outro | `success` (celebrate) | xl |
| Onboarding slides | per slide | 150–180 |
| Login card | `welcome` (wave) | sm |
| Sync in progress | `working` | md |
| Pending sync cleared | `success` (celebrate) | md |
| Day Book / Inventory empty | `empty` via `FinnyState` | lg |
| Error boundary | `error` (no animation) | md |
| Ask your business | `help` | sm |

**Not** on the dashboard by default — per the UX rule, no large mascot on a
screen whose job is showing numbers.

## The App Tour

Six steps in `constants/appGuideSteps.ts`, driven by the existing spotlight
system (`AppGuideProvider` measures a `GuideTarget` and cuts a hole in the dim
overlay).

1. **Welcome to TallyFin** — full screen, tagline
2. **Switch Companies Easily** → `company-picker`
3. **Your Business at a Glance** → `dashboard`
4. **Everything Within Reach** → `bottom-nav`
5. **Choose Your Language** → `language-switcher`
6. **Ready to Get Started?** — full screen, tagline, "Get Started"

### App Tour copy is ENGLISH ONLY

Tour titles, bodies and the Skip / Next / Get Started chrome are **not** routed
through i18n. This is intentional brand voice, and it is why the `guide.*` keys
were removed from the locale files. The only non-English string is the tagline.

### The bottom-nav target was previously pointing at nothing

`MainNavigator` puts a `tab-bar` target on React Navigation's `BottomTabBar` —
but the dashboard sets `tabBarStyle: { display: 'none' }` and renders its own
`BottomNavigation`. That step spotlighted nothing and fell back to the "finding
it" message. Step 4 now targets the visible bar inside
`PremiumDashboardScreen`. The old `tab-bar` id is kept for other screens.

The tour card also repositions itself: above the bottom bar for nav steps, below
the target when the target sits in the top third, otherwise bottom-anchored.

## Replaying the tour

Settings → **Show app tour**. `replayAppGuide` clears the persisted
`hasSeenAppGuide` flag and restarts.
