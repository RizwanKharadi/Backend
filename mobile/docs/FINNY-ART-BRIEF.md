# Finny artwork brief — generation prompts

Prompts for producing Finny's 11 poses. **Always attach the existing "Meet
Finny" character sheet as a reference image** when generating — text alone will
not hold his identity across 11 renders.

The current PNGs in `src/assets/mascot/` are a **dolphin** from an earlier
concept and must be replaced.

---

## 1. Master character block

Paste this at the **start of every prompt**, unchanged. It is what keeps Finny
the same character across all 11 renders.

> 3D animated character mascot, Pixar/Disney animation film style, high-quality
> stylised 3D render. "Finny", a friendly male finance genie. Bright blue skin,
> rounded friendly proportions, large expressive dark eyes, warm confident
> smile, neat glossy black moustache and short black beard. Royal blue turban
> with a single tall white feather and a round gold ornament at the front, small
> gold hoop earring. Wearing a royal blue short-sleeved collared shirt with a
> small white "TF" TallyFin logo on the left chest, thick gold cuff bracelets on
> both wrists and a wide gold belt at the waist. **No legs** — his lower body
> tapers into a smooth curling blue genie tail that floats above the ground. A
> small ornate golden magic lamp floats or rests below him with a faint warm
> glow. Soft studio lighting, gentle rim light, subtle sparkle accents.
> Premium, modern, trustworthy, professional-friendly — an adult business
> companion, NOT a children's cartoon.

## 2. Technical requirements

Append this to **every prompt**:

> Full body, centred, facing camera at a slight three-quarter angle, consistent
> character scale and camera distance across the set. Isolated on a fully
> transparent background, no shadow on the floor, no scenery, no text, no
> watermark, no border. Square composition with even padding around the
> character.

**Output spec**

| | |
|---|---|
| Format | PNG with real alpha transparency |
| Size | 1024×1024 (square) |
| Framing | Identical scale in every pose — Finny's head at the same height |
| Background | Fully transparent (not white) |

Same camera distance in every render matters more than it sounds: the app swaps
these in the same fixed-size box, so a pose rendered "zoomed in" will visibly
jump.

## 3. The 11 poses

Master block + pose line + technical block.

| # | File | Pose line |
|---|---|---|
| 1 | `finny-welcome.png` | Waving hello with his right hand raised, warm welcoming smile, other hand relaxed at his side. Open, greeting body language. |
| 2 | `finny-intro.png` | Presenting with both arms open and palms up, as if introducing something in front of him, proud friendly expression. |
| 3 | `finny-pointing.png` | Pointing clearly with his right index finger toward the lower right, looking in the same direction, helpful explaining expression. |
| 4 | `finny-thinking.png` | Right hand on his chin in a thoughtful pose, head tilted slightly, eyes looking up, curious considering expression. A small glowing lightbulb floats near his head. |
| 5 | `finny-working.png` | Holding a modern smartphone in one hand and tapping the screen with the other, looking down at it, focused and busy but relaxed. Faint blue data glow from the screen. |
| 6 | `finny-success.png` | Celebrating — both arms raised in triumph, big joyful smile, eyes closed happily. Gold and green confetti sparkles around him. |
| 7 | `finny-happy.png` | Confident thumbs-up with his right hand, cheerful reassuring smile, relaxed posture. |
| 8 | `finny-empty.png` | Curious and searching — one hand shading his eyes as if looking into the distance, head tilted, mildly puzzled but positive expression. **Not sad, not disappointed.** |
| 9 | `finny-error.png` | Slightly concerned but reassuring — one hand raised palm-out in a calming "it's alright" gesture, gentle apologetic smile, eyebrows raised. **Calm and recoverable, not alarmed or distressed.** |
| 10 | `finny-help.png` | Holding a tablet toward the viewer with one hand, other hand open in an offering gesture, attentive helpful expression, as if asking "how can I help?" |
| 11 | `finny-wink.png` | Playful wink with one eye closed, small grin, casual finger-gun or relaxed thumbs-up gesture. Light-hearted but still professional. |

## 4. Best approach for consistency

1. **Generate a 3-pose sheet first** (welcome, pointing, success) in a single
   image, with the reference sheet attached. One generation holds identity far
   better than three separate ones.
2. Pick the sheet you like, then use **that render** as the reference for the
   remaining poses, one at a time.
3. If a pose drifts off-model, regenerate it against the approved sheet rather
   than accepting it — one off-model pose is very visible when the app swaps
   between them.

Priority if you only produce some: **welcome, pointing, success** (the App Tour
needs all three), then **empty**, **error**, **working**.

## 5. Dropping them in

Save all files to `mobile/src/assets/mascot/` using the filenames above, then
tell me — the swap is one file (`finnyPoses.ts`), and no screen code changes.

If you deliver them one at a time, that's fine: the pose registry can point
several states at the art that exists and I flip each one over as it lands.
