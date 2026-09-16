# V46 — Intro fixes

## 1. Intro no longer goes blank after the video

Root cause was in the media asset, not the page code. The source clip
`quality_nonferrous_intro_light.mp4` was 10.0s long and its last ~1.0s washed the
whole composition out to white and then faded to black. The old script froze the
player on its "last visible frame", but that frame *was* the black one — so the
screen went dark the moment playback finished.

Fixes:

- The clip is re-encoded and trimmed to **8.70s**, dropping the wash-out/fade-to-black
  entirely (audio gets a 0.6s fade-out so the cut isn't abrupt). The final frame is now
  the fully composed end state: logo, QUALITY / TRACEABILITY / CONTINUOUS IMPROVEMENT,
  NON-FERROUS, the tagline, Cupronickel Division, QUALITY INTELLIGENCE, the QCR / RCA /
  DATA cards and the ENTER DASHBOARD button.
- New asset `quality_nonferrous_intro_endcard.png` — a pixel-exact copy of that final
  frame — is layered over the `<video>` and fades in the instant playback stops. Freezing
  no longer depends on the browser retaining a decoded frame, which is what made the
  behaviour inconsistent across browsers. It is also wired up as the `poster`, so there is
  no black flash on load and the composition still shows if autoplay is blocked outright.
- `.intro-stage` now creates its own stacking context (`z-index:1; isolation:isolate`) so
  the ambient glow, the two sweep lines and the drifting particles animate **above** the
  frozen end-card instead of being covered by it. Background motion continues; the video
  plays once and stops.
- Freeze is now driven by `timeupdate` (duration − 0.08s), with `ended`, `pause`, `error`
  and a duration-based timeout as fallbacks, so the end-card appears even if the clip
  stalls. The video never loops or restarts.

## 2. "Cupronickel Division" sat on top of the divider line

This was baked into the video frames, which is why earlier CSS-side attempts had no
effect. The orange rule was running straight through the text like a strike-through.

- The affected band is repaired at the frame level: the region is cleaned, the division
  name is re-rendered at its original size, colour and centre, and the orange rule is
  moved **below** it as a proper underline (y 352–355, x 490–790).
- The repair is composited into the video from 1.53s (matching when the rule originally
  appeared) through to the end, so it is correct during playback as well as on the
  frozen end-card.

## 3. Intro hint legibility

`CLICK ENTER DASHBOARD TO CONTINUE` was near-white. That was readable only because the
intro used to end on black; against the light composition it was invisible. It is now
dark slate, shifting to brand orange with a soft pulse once the video has stopped.

## Files touched

- `quality_nonferrous_intro_light.mp4` (re-encoded, 8.70s)
- `quality_nonferrous_intro_endcard.png` (new)
- `index.html` (intro styles, end-card markup, freeze logic)
- `server.py` (end-card added to the static asset allow-list)
