import * as THREE from "three";

import {
  ABOUT_SLOT_ID,
  HERO_NEAR_SLOT_ID,
  HERO_SLOT_ID,
  imageAspect,
  imageSource,
} from "./images";
import {
  type CategoryId,
  getCategory,
  tileSlotId,
} from "./content";

/* -------------------------------------------------------------------------- */
/* Scene layout                                                               */
/* -------------------------------------------------------------------------- */

/** Number of photographs per category on the 3D journey. */
const WALL_PLANE_COUNT = 6;

/** Below this canvas CSS width, use the narrower mobile field/pixel-ratio. */
const MOBILE_LAYOUT_MAX_WIDTH = 700;

/* -------------------------------------------------------------------------- */
/* Portfolio corridor                                                        */
/*                                                                            */
/* UNIFIED MODEL — every category (Portraits, Landscape, Weddings, Fashion)   */
/* runs through this exact same code path, with no per-category branching:   */
/* the six photographs hang at FIXED world positions along the corridor the  */
/* existing camera path (CAMERA_KEYFRAMES) already dollies through — there   */
/* is no synthetic "dive" term and no per-moment grouping/chunking. Multiple  */
/* photos are simply visible at once, at different distances from the live   */
/* camera: the nearest reads sharp and large, one or two ahead read smaller  */
/* and softer (not yet reached), and ones just passed fade out (not cut).    */
/* Perspective projection alone already makes distant photos look smaller;   */
/* portfolioFocusAt below only adds the blur/opacity/scale-emphasis curve on */
/* top of that, driven purely by each photo's live distance from the camera  */
/* — a continuous function of scroll progress `p` (no discrete states, no    */
/* stations, nothing that "swaps" one photo for another).                   */
/* -------------------------------------------------------------------------- */

interface PortfolioFieldSpec {
  /**
   * World Y offset only — there is deliberately no lateral (X) field here.
   * X is pinned to the camera's own live X every frame (see
   * updateWallMeshes), so a photo's only axis of motion relative to the
   * viewer is depth: it approaches from far away and passes near/through
   * the camera, never drifting toward either screen edge. An earlier
   * version carried a per-photo `lateral` world offset (alternating sides
   * to avoid stacking); combined with CAMERA_KEYFRAMES' own sideways sweep
   * (eye.x runs -3.5 → 3.5 through the middle of this band), a fixed-world
   * lateral offset meant photos drifted off-centre — sometimes clear off
   * one edge with an empty gap on the other — as the camera swung. Removed
   * entirely rather than zeroed, so it can't come back.
   */
  vertical: number;
  /** World Z. Negative, matching CAMERA_KEYFRAMES' travel direction. */
  depth: number;
}

/**
 * Hand-placed so consecutive photos sit at different depths along the
 * camera's existing travel (eye.z runs roughly +1 → -19 across the active
 * portfolio scroll band), so several are on screen at once without
 * stacking. Reused identically for all four categories — only the photo
 * CONTENT (texture + aspect-matched geometry) varies by category.
 */
const PORTFOLIO_FIELD_DESKTOP: readonly PortfolioFieldSpec[] = [
  { vertical: 0.35, depth: -1 },
  { vertical: -0.45, depth: -4 },
  { vertical: 0.5, depth: -7 },
  { vertical: -0.55, depth: -10 },
  { vertical: 0.25, depth: -13 },
  { vertical: -0.35, depth: -16 },
];

const PORTFOLIO_FIELD_MOBILE: readonly PortfolioFieldSpec[] = [
  { vertical: 0.2, depth: -1 },
  { vertical: -0.25, depth: -4 },
  { vertical: 0.3, depth: -7 },
  { vertical: -0.3, depth: -10 },
  { vertical: 0.15, depth: -13 },
  { vertical: -0.2, depth: -16 },
];

/**
 * Plane area (world units²) each photo occupies, before the focus-curve's
 * scale multiplier. The camera's vertical FOV (see PerspectiveCamera below)
 * is identical on mobile and desktop, so a photo's apparent SCREEN-height
 * fraction at a given distance depends only on this area, not on viewport
 * width — a narrower mobile viewport is not a reason to shrink it. Sized
 * slightly ABOVE desktop's instead: mobile screens are viewed from closer,
 * so photos need to read comfortably large, not smaller.
 */
const PORTFOLIO_TILE_AREA_DESKTOP = 3.6;
const PORTFOLIO_TILE_AREA_MOBILE = 4.4;

/**
 * Distance-from-camera thresholds driving the corridor's continuous focus
 * curve — see portfolioFocusAt. All in world units, matching the field
 * depths above.
 *   > FAR            : not yet reached — soft, slightly smaller
 *   NEAR..FAR         : approaching — blends from soft/small to sharp/large
 *   0..NEAR (either side of the camera) : sharp, full size — "the current one"
 *   < PASS_FADE (behind the camera)     : just passed — fades out
 *   <= PASS_GONE                        : fully invisible
 */
const FIELD_FAR = 8;
const FIELD_NEAR = 2.4;
const FIELD_PASS_FADE = 0.6;
const FIELD_PASS_GONE = -2.4;
// Softened from 0.55 — at FIELD_FAR the photo is meant to read as "further
// away and slightly soft," not barely perceptible; the old max blurred it
// past legibility while it was still meant to be the visible "approaching"
// state.
const FIELD_BLUR_MAX = 0.4;
const FIELD_SCALE_NEAR = 1.15;
// Nudged up from 0.8 — a "not yet reached" photo should still read clearly,
// just smaller than the sharp/near pose, not shrunk enough to feel faint.
const FIELD_SCALE_FAR = 0.88;

/**
 * Hard ceiling on how much of the viewport's vertical field of view a
 * corridor photo's SHARP/near pose may occupy, however close the camera's
 * fixed flight path (CAMERA_KEYFRAMES) happens to pass a given field
 * position (PORTFOLIO_FIELD_DESKTOP/MOBILE) — two of the six hand-placed
 * stops bring the camera within under a metre of the plane, where raw
 * perspective alone (scale 1.15 included) would blow the photo up past
 * 2x the frame edge-to-edge. This clamps the corridor's ambient scale (NOT
 * the click-to-inspect "presented" pose, which is deliberately close-up) so
 * every photo's sharpest moment reads as "comfortable middle distance —
 * large and clear, never on top of the camera," regardless of exactly how
 * close a given fly-by gets.
 */
const FIELD_MAX_SCREEN_FILL = 0.62;

/**
 * A photo's blur/scale/opacity as a pure function of its SIGNED distance
 * along the camera's forward axis (positive = still ahead, negative =
 * already passed) — continuous and reversible: scrubbing `p` backward
 * retraces exactly the same curve, since it depends only on live geometry,
 * not on any accumulated or time-based state.
 */
function portfolioFocusAt(localDepth: number): {
  blur: number;
  scale: number;
  opacity: number;
} {
  // Approaching photos soften over the full FAR..NEAR range; passed photos
  // soften faster (over a shorter distance) so they read as "just went by"
  // rather than lingering sharp long after the camera has moved on.
  const softT =
    localDepth >= 0
      ? smoothstep(FIELD_NEAR, FIELD_FAR, localDepth)
      : smoothstep(FIELD_NEAR, FIELD_FAR, -localDepth * 1.6);
  const blur = softT * FIELD_BLUR_MAX;
  const scale = FIELD_SCALE_NEAR - softT * (FIELD_SCALE_NEAR - FIELD_SCALE_FAR);
  const opacity =
    localDepth < FIELD_PASS_FADE
      ? smoothstep(FIELD_PASS_GONE, FIELD_PASS_FADE, localDepth)
      : 1;
  return { blur, scale, opacity };
}

/**
 * Non-blocking click-to-inspect: a clicked photo eases toward a closer,
 * larger "presented" pose directly ahead of the camera — see focusAt/
 * updateWallMeshes — without pausing the scroll-driven corridor in any way.
 * Any further scroll immediately cancels it (see FOCUS_DISMISS_EPSILON in
 * animate), so there's no modal state to explicitly close.
 */
const FOCUS_PRESENT_DEPTH = 3.4;
const FOCUS_PRESENT_SCALE = 1.7;
/** Progress moved since a click before it's treated as "the user scrolled, drop the focus." */
const FOCUS_DISMISS_EPSILON = 0.004;

/** Per-mesh animation state, read/written every frame — not React state. */
interface WallMeshState {
  index: number;
  vertical: number;
  depth: number;
  /** Smoothed hover-tilt, applied as a small local rotation after facing. */
  tiltX: number;
  tiltY: number;
  /** Eased 0..1 — see focusAt/FOCUS_PRESENT_DEPTH. */
  focusAmount: number;
}

/**
 * Camera path through the scene, keyed to scroll progress (`p`, 0→1 across the
 * sticky track): push through the hero, sweep left across the wall, sweep
 * right, then continue into the About plane.
 *
 * Journey progress is normalised so that 0 → 1 covers the sticky track (hero,
 * gallery wall, about). The booking section continues the same path beyond 1,
 * up to `BOOKING_PROGRESS_END`, so one scalar drives the whole page rather
 * than the camera stalling the moment the track runs out.
 */
const TRACK_PROGRESS_END = 1.0;
const BOOKING_PROGRESS_END = 1.4;

/**
 * DIAGNOSED STALL (fixed below): the p:0.3→0.55 leg used to hold eye.z at a
 * constant -8 across a full quarter of total scroll progress (Δp=0.25, the
 * single largest span in the whole keyframe list) — it only swept sideways
 * (x: -3.5 → 3.5), never advancing forward. Since the portfolio corridor's
 * photos are hung at FIXED WORLD DEPTHS (see PORTFOLIO_FIELD_DESKTOP/MOBILE)
 * and which one reads as "current" is driven purely by eye.z's live distance
 * to that depth, a frozen eye.z meant scrolling through that entire quarter
 * of progress advanced no photo at all — a dead plateau — while the next leg
 * (p:0.55→0.64, Δp=0.09) then had to rush eye.z from -8 to -19 (more than
 * half the whole corridor's depth span) in under a tenth of the progress
 * range, so several photos snapped past in a rush right as the section was
 * already fading out. Uniformly reducing scroll sensitivity (SCROLL_TO_DIVE_
 * RATE) made this uneven pacing much more perceptible, since the already-
 * large dead span now costs 3x the physical scroll to cross.
 *
 * Fix: re-paced eye.z at the p:0.3 and p:0.55 keyframes (and only z — x/y and
 * the "sweep left, sweep right" character are untouched) so eye.z advances at
 * a constant rate across the whole p:0.16→0.64 span instead of stalling then
 * rushing. `look`'s z keeps the same -6 offset from `pos`'s z used throughout
 * this stretch. This is a pacing fix to the camera path itself — the single
 * source every category's corridor reads its "current" photo from — not a
 * per-photo or per-category patch, so it applies uniformly everywhere this
 * path is used.
 */
const CAMERA_KEYFRAMES = [
  { p: 0.0, pos: [0, 0, 6], look: [0, 0, -4] },
  { p: 0.16, pos: [0, 0, 1.2], look: [0, 0, -4] },
  { p: 0.3, pos: [-3.5, 0.2, -4.8], look: [-3.5, 0.2, -10.8] },
  { p: 0.55, pos: [3.5, 0.2, -15.2], look: [3.5, 0.2, -21.2] },
  { p: 0.64, pos: [0, 0.1, -19], look: [0, 0, -25] },
  { p: 0.85, pos: [1.4, 0.3, -24], look: [-1.8, 0, -27] },
  { p: 1.0, pos: [0, 0.15, -25], look: [-1, 0, -29] },
  // --- booking: the path continues past the sticky track, drifting down and
  // across so the backdrop keeps moving while the section is read. ---
  { p: 1.16, pos: [-1.05, -0.1, -26.5], look: [-1.7, -0.25, -30.4] },
  { p: 1.28, pos: [-0.2, -0.4, -27.4], look: [-0.4, -0.5, -31.2] },
  { p: BOOKING_PROGRESS_END, pos: [1.15, -0.72, -28.4], look: [0.4, -0.8, -32.1] },
] as const;

/** Scroll window in which the gallery corridor is close enough to be interactive. */
const PORTFOLIO_RANGE: readonly [number, number] = [0.18, 0.62];

/** Time-driven rise-then-fall pulse for a category switch — see transitionCategory. */
const CATEGORY_SWITCH_DURATION = 860;

/** Tint the about print brightens toward while the booking frame is lit. */
const RIM_LIT_TINT = new THREE.Color(0xcfc8b8);

/** Base (fully-active) opacities for the hero's two photo layers. */
const HERO_FAR_BASE_OPACITY = 0.96;
const HERO_NEAR_BASE_OPACITY = 0.98;

/**
 * The gold-rimmed "keepsake" print (aboutMesh/rimMesh) now exists ONLY as
 * the booking section's backdrop — About's own visual is the scattered
 * tile field below. Its entrance (fade + scale-up + drift from depth) is
 * keyed off `bookingLocal` (0 the instant booking starts) rather than
 * scroll progress `p`, since it no longer needs to wait for the portfolio
 * wall — the tile field already handles About's own section-clearing.
 */
const BOOKING_BACKDROP_ENTRANCE_RANGE: readonly [number, number] = [0, 0.18];
const BOOKING_BACKDROP_SCALE_START = 0.9;
const BOOKING_BACKDROP_DEPTH_DRIFT = 1.4;

function bookingBackdropOpacityAt(bookingLocal: number): number {
  return smoothstep(
    BOOKING_BACKDROP_ENTRANCE_RANGE[0],
    BOOKING_BACKDROP_ENTRANCE_RANGE[1],
    bookingLocal,
  );
}

/**
 * About section: a scattered field of background photo tiles (reusing
 * existing portfolio images — a deliberate portrait/landscape mix) plus a
 * drifting particle field, both positioned relative to the camera's path,
 * both cleared via the depth dive (see ABOUT_DIVE_DISTANCE) as the camera
 * dives through them. No new assets, no separate transition system. This is
 * its own independent mechanism — unrelated to, and untouched by, the
 * portfolio corridor above.
 */
const ABOUT_FIELD_SLOT_IDS = [
  "portfolio-portraits-0",
  "portfolio-landscape-1",
  "portfolio-portraits-2",
  "portfolio-landscape-3",
  "portfolio-fashion-0",
  "portfolio-portraits-4",
  "portfolio-landscape-4",
  "portfolio-weddings-1",
] as const;

interface AboutFieldTileSpec {
  /**
   * World X offset (via the camera's `right` vector — see updateAboutField),
   * intentionally REINSTATED here after being removed from the portfolio
   * corridor. This is a deliberate, section-scoped divergence, not a
   * reversion of that fix: About's tile field is meant to sit toward the
   * left/right thirds of the frame so the centre stays clear for the text
   * block, whereas the corridor's photos are the sole subject and must stay
   * dead-centre. Do not copy this field or its use back onto
   * PortfolioFieldSpec/PORTFOLIO_FIELD_DESKTOP/MOBILE/updateWallMeshes.
   */
  lateral: number;
  vertical: number;
  depth: number;
  rotationDeg: number;
  scale: number;
}

/**
 * Hand-placed, spread across depth so the dive passes them at different
 * moments. Depths start considerably further out than the corridor's own
 * field (6–22.5 vs. the booking dive's ABOUT_DIVE_DISTANCE of 7.5) so the
 * nearest tile is still genuinely distant — small, soft — at the moment
 * About's entrance fade finishes (see ABOUT_FIELD_FADE_IN), then visibly
 * approaches and passes as the dive intensifies through ABOUT_DIVE_RANGE,
 * rather than already reading "arrived" the instant it fades in. `lateral`
 * alternates left/right, magnitude ~2.6–4.2, so every tile clears the
 * centre column the About text sits in (see .journeyAboutInner's
 * max-width) while still combining with the depth motion above — tiles
 * approach from far away along a path offset to one side, not a static
 * side-grid.
 */
const ABOUT_FIELD_TILES: readonly AboutFieldTileSpec[] = [
  { lateral: -3.2, vertical: 1.6, depth: 6.0, rotationDeg: -4, scale: 1.0 },
  { lateral: 2.6, vertical: -1.2, depth: 8.0, rotationDeg: 3, scale: 0.9 },
  { lateral: -1.6, vertical: -2.0, depth: 10.0, rotationDeg: 5, scale: 1.1 },
  { lateral: 3.8, vertical: 0.8, depth: 12.5, rotationDeg: -2, scale: 0.85 },
  { lateral: -4.2, vertical: -0.4, depth: 15.0, rotationDeg: 2, scale: 1.0 },
  { lateral: 2.8, vertical: 2.2, depth: 17.5, rotationDeg: -6, scale: 0.8 },
  { lateral: -3.0, vertical: 2.6, depth: 20.0, rotationDeg: 4, scale: 0.9 },
  { lateral: 4.4, vertical: -2.4, depth: 22.5, rotationDeg: -3, scale: 0.75 },
];

const ABOUT_FIELD_TILE_COUNT_DESKTOP = 8;
const ABOUT_FIELD_TILE_COUNT_MOBILE = 4;
/**
 * The camera aspect (width/height) ABOUT_FIELD_TILES' `lateral` magnitudes
 * were hand-tuned against — a representative desktop widescreen ratio.
 * ROOT CAUSE fix: `lateral` is a WORLD-UNIT offset, and the frustum's actual
 * half-width at a given depth is `depth * tan(vFov/2) * aspect` — linear in
 * aspect. A lateral magnitude that sits comfortably inside a ~1.6-aspect
 * desktop frustum (e.g. -3.2 at depth 6, frustum half-width ~4.0) is more
 * than double a ~0.46-aspect mobile portrait frustum's half-width (~1.1) at
 * that same depth — the tiles were positioned, just entirely outside the
 * camera's view. Scaling `lateral` by `camera.aspect / this reference`
 * (see updateAboutField) keeps every tile at the same FRACTION of the
 * frustum's width regardless of viewport shape, instead of a fixed world
 * offset tuned for one aspect ratio.
 */
const ABOUT_FIELD_LATERAL_REFERENCE_ASPECT = 1.6;
/**
 * Multiply tint — atmospheric background, not full-contrast photos
 * competing with the text. Lightened from 0x39352f (~22% brightness),
 * which combined with the opacity below multiplied photos down far enough
 * to read as barely-distinguishable from the black page background.
 */
const ABOUT_FIELD_TINT = new THREE.Color(0x726a5c);
const ABOUT_FIELD_TILE_AREA = 3.4;
const ABOUT_FIELD_TILE_BASE_OPACITY = 0.8;

const ABOUT_FIELD_FADE_IN: readonly [number, number] = [0.64, 0.74];
/**
 * Tiles clear before booking starts (p=1.0), per the section-clearing
 * rules — but ending this at 0.97 (design-audit finding) left a ~3%-of-
 * track stretch (about 14vh of scroll) where the sticky stage was still
 * pinned full-screen with nothing left drawn in it: About's tiles/text
 * had already faded, and the booking backdrop (aboutMesh) only starts
 * its own fade-in once bookingLocal > 0, which lands almost exactly at
 * p=1.0. Ending the fade-out right at the unpin point removes that dead
 * gap without touching the entrance timing at all.
 */
const ABOUT_FIELD_FADE_OUT: readonly [number, number] = [0.88, 0.995];
/** Particles persist a little longer/thinner than the tiles for atmosphere, then also clear. */
const ABOUT_PARTICLES_FADE_OUT: readonly [number, number] = [0.92, 1.0];
const ABOUT_PARTICLES_BASE_OPACITY = 0.5;
const ABOUT_PARTICLE_COUNT = 46;

const ABOUT_DIVE_DISTANCE = 7.5;
const ABOUT_DIVE_RANGE: readonly [number, number] = [0.64, 0.95];

function aboutDiveIntensityAt(p: number): number {
  return smoothstep(ABOUT_DIVE_RANGE[0], ABOUT_DIVE_RANGE[1], p);
}

function aboutFieldOpacityAt(p: number): number {
  return (
    smoothstep(ABOUT_FIELD_FADE_IN[0], ABOUT_FIELD_FADE_IN[1], p) *
    (1 - smoothstep(ABOUT_FIELD_FADE_OUT[0], ABOUT_FIELD_FADE_OUT[1], p))
  );
}

function aboutParticlesOpacityAt(p: number): number {
  return (
    smoothstep(ABOUT_FIELD_FADE_IN[0], ABOUT_FIELD_FADE_IN[1], p) *
    (1 -
      smoothstep(
        ABOUT_PARTICLES_FADE_OUT[0],
        ABOUT_PARTICLES_FADE_OUT[1],
        p,
      ))
  );
}

/** Cheap deterministic pseudo-random in [0,1) — stable across reloads, no Math.random() jitter. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const BLUR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 5x5 box blur, used to fake depth-of-field on planes away from the camera.
 * `tint` multiplies the sampled colour — white (1,1,1) is a no-op for the
 * portfolio corridor photos; the About section's background tiles use a dark
 * tint here instead of a separate material/shader, so both share one system.
 */
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float blur;
  uniform float opacity;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    vec4 c = vec4(0.0);
    float total = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 o = vec2(float(x), float(y)) * blur * 0.01;
        c += texture2D(map, vUv + o);
        total += 1.0;
      }
    }
    c /= total;
    gl_FragColor = vec4(c.rgb * tint, c.a * opacity);
  }
`;

/**
 * Same depth-of-field effect, 3x3 (9 taps vs. the desktop shader's 25) —
 * mobile GPUs have far less fragment-shader fill-rate than desktop, and
 * several transparent, blurred planes can be on screen at once (corridor
 * photos, hero, about, rim). Compiled once at construction based on
 * viewport width, not branched per-frame, so there's no runtime cost to
 * having two variants.
 */
const BLUR_FRAGMENT_SHADER_MOBILE = /* glsl */ `
  uniform sampler2D map;
  uniform float blur;
  uniform float opacity;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    vec4 c = vec4(0.0);
    float total = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        vec2 o = vec2(float(x), float(y)) * blur * 0.014;
        c += texture2D(map, vUv + o);
        total += 1.0;
      }
    }
    c /= total;
    gl_FragColor = vec4(c.rgb * tint, c.a * opacity);
  }
`;

/** Desktop devicePixelRatio cap. Mobile uses a lower one — see the constructor. */
const PIXEL_RATIO_MAX_DESKTOP = 1.75;
const PIXEL_RATIO_MAX_MOBILE = 1.5;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function detectWebglSupport(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

/* -------------------------------------------------------------------------- */
/* Section fade curves                                                        */
/*                                                                            */
/* ROOT CAUSE FIX: previously only the HTML overlays faded with progress —    */
/* the 3D planes underneath (hero backdrop, wall photos, about portrait)      */
/* stayed fully opaque the whole time and were kept out of frame purely by    */
/* depth/blur/fog. That meant a spent section's content was still literally   */
/* sitting in the scene, and wherever the depth/fog trick fell short (a       */
/* plane still inside the frustum, not yet far or blurred enough to read as   */
/* gone) it ghosted through as bleed-through in a LATER section's            */
/* background. These curves are the single source of truth for whether a     */
/* section is "active"; both the HTML overlays (updateOverlays) and the      */
/* WebGL planes themselves (animate/updateWallMeshes) read the same ones so  */
/* the two can never drift out of sync with each other.                      */
/* -------------------------------------------------------------------------- */

const HERO_FADE_OUT: readonly [number, number] = [0.08, 0.16];
const PORTFOLIO_FADE_IN: readonly [number, number] = [0.2, 0.27];
const PORTFOLIO_FADE_OUT: readonly [number, number] = [0.57, 0.64];
const ABOUT_TEXT_FADE_IN: readonly [number, number] = [0.64, 0.71];
/** Matches ABOUT_FIELD_FADE_OUT's end — see the comment there. */
const ABOUT_TEXT_FADE_OUT: readonly [number, number] = [0.9, 0.995];

function heroOpacityAt(p: number): number {
  return 1 - smoothstep(HERO_FADE_OUT[0], HERO_FADE_OUT[1], p);
}

function portfolioOpacityAt(p: number): number {
  return (
    smoothstep(PORTFOLIO_FADE_IN[0], PORTFOLIO_FADE_IN[1], p) *
    (1 - smoothstep(PORTFOLIO_FADE_OUT[0], PORTFOLIO_FADE_OUT[1], p))
  );
}

function aboutTextOpacityAt(p: number): number {
  return (
    smoothstep(ABOUT_TEXT_FADE_IN[0], ABOUT_TEXT_FADE_IN[1], p) *
    (1 - smoothstep(ABOUT_TEXT_FADE_OUT[0], ABOUT_TEXT_FADE_OUT[1], p))
  );
}

/**
 * Handoff between the portfolio corridor and About's depth-dive/tile
 * scatter: a brief, near-opaque "dark hold" DOM overlay (see
 * JourneyOverlays.handoff) bridging the two systems rather than extending
 * either one into the other's territory — the corridor's last photos fade
 * out, the screen holds near-black for a beat, then About's own entrance
 * (tile field, particles, text — all untouched) fades up through it.
 * Centred on p=0.64, exactly where PORTFOLIO_FADE_OUT finishes and
 * ABOUT_FIELD_FADE_IN/ABOUT_TEXT_FADE_IN/ABOUT_DIVE_RANGE all begin, so the
 * hold covers precisely the seam between the two mechanics and nothing more.
 */
const HANDOFF_RANGE: readonly [number, number] = [0.59, 0.685];
const HANDOFF_PEAK: readonly [number, number] = [0.625, 0.655];

function handoffOpacityAt(p: number): number {
  const rise = smoothstep(HANDOFF_RANGE[0], HANDOFF_PEAK[0], p);
  const fall = 1 - smoothstep(HANDOFF_PEAK[1], HANDOFF_RANGE[1], p);
  return Math.min(rise, fall);
}

/**
 * Plane geometry with the given aspect ratio (width / height) occupying a
 * fixed area, so photos of different orientations hang at comparable visual
 * weight — like prints of the same paper size in different orientations.
 */
function planeForAspect(aspect: number, area: number): THREE.PlaneGeometry {
  const height = Math.sqrt(area / aspect);
  return new THREE.PlaneGeometry(height * aspect, height);
}

/** Diagonal-hatch fallback drawn whenever a slot has no photograph yet. */
function createPlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#131316";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(244,242,238,0.05)";
  ctx.lineWidth = 2;
  for (let i = -512; i < 512; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 512, 512);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Cover-fit an image inside its plane by cropping through UV repeat/offset,
 * so photographs never stretch regardless of their native aspect ratio.
 */
function applyCoverFit(
  texture: THREE.Texture,
  planeAspect: number,
  zoom: number,
): void {
  const image = texture.image as { width?: number; height?: number } | null;
  if (!image?.width || !image.height) return;

  const imageAspect = image.width / image.height;
  if (imageAspect > planeAspect) {
    texture.repeat.set(planeAspect / imageAspect / zoom, 1 / zoom);
  } else {
    texture.repeat.set(1 / zoom, imageAspect / planeAspect / zoom);
  }
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                      */
/* -------------------------------------------------------------------------- */

/** Elements the render loop drives directly, bypassing React for per-frame work. */
export interface JourneyOverlays {
  hero: HTMLElement | null;
  scrollCue: HTMLElement | null;
  portfolio: HTMLElement | null;
  portfolioCaption: HTMLElement | null;
  about: HTMLElement | null;
  /** Dark hold bridging the portfolio corridor and About's entrance — see handoffOpacityAt. */
  handoff: HTMLElement | null;
}

export interface JourneySceneOptions {
  canvas: HTMLCanvasElement;
  /** The tall element whose scroll position maps to camera progress. */
  track: HTMLElement;
  /**
   * The booking section, which extends the camera path past the track. Looked
   * up lazily because it lives outside the journey's subtree and mounts
   * independently.
   */
  getBookingSection: () => HTMLElement | null;
  getOverlays: () => JourneyOverlays;
  parallaxIntensity: number;
  initialCategory: CategoryId;
  onHoverChange: (index: number, caption: string) => void;
  onReady: () => void;
  /**
   * Advances the page's Lenis instance (smooth-scroll layer) by one frame,
   * called first thing in the render loop so the native scroll position it
   * drives is up to date before readScrollProgress() measures it this
   * frame. Injected rather than imported so this class stays a plain,
   * options-driven renderer — see Journey.tsx for the Lenis lifecycle.
   */
  tickLenis: () => void;
}

export class JourneyScene {
  private readonly options: JourneySceneOptions;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-10, -10);
  /** Reused every frame in updateAboutField's particle loop to avoid allocating 46 Vector3s/frame. */
  private readonly scratchVec3 = new THREE.Vector3();

  private readonly farMaterial: THREE.MeshBasicMaterial;
  private readonly farMesh: THREE.Mesh;
  private readonly nearMaterial: THREE.MeshBasicMaterial;
  private readonly nearMesh: THREE.Mesh;
  /** The booking backdrop's "keepsake" print — see BOOKING_BACKDROP_ENTRANCE_RANGE. */
  private readonly aboutMaterial: THREE.MeshBasicMaterial;
  private readonly aboutMesh: THREE.Mesh;
  /**
   * Gold frame just behind the about plane. The plane's face is a dark
   * texture multiplied by a dark tint — near-black on a black page — so on
   * its own, its motion through the booking section is real but invisible.
   * The frame is the bright element that makes that motion legible; it only
   * fades in across the booking range.
   */
  private readonly rimMaterial: THREE.MeshBasicMaterial;
  private readonly rimMesh: THREE.Mesh;
  /** The six corridor photos for the active category — see PORTFOLIO_FIELD_DESKTOP. */
  private readonly wallMeshes: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  >[];
  /** About section's own visual — see ABOUT_FIELD_TILES. */
  private readonly aboutFieldMeshes: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  >[];
  private readonly aboutParticles: THREE.Points;
  private readonly aboutParticleSeeds: {
    lateral: number;
    vertical: number;
    depth: number;
    driftSeed: number;
  }[];

  private category: CategoryId;
  private ownedTextures = new Set<THREE.Texture>();
  private placeholder: THREE.CanvasTexture;

  /**
   * 0..1..0 pulse driven by transitionCategory's timer, not scroll — fades
   * the whole corridor out, swaps textures at the peak, fades back in.
   */
  private categorySwitchFade = 0;

  /** Index of the clicked-to-inspect photo, or -1 — see focusAt. */
  private focusedIndex = -1;
  /** Scroll progress at the moment focus started; any further movement past FOCUS_DISMISS_EPSILON drops it. */
  private focusedFromProgress = 0;

  /** Smoothed scroll progress; the raw value is eased toward each frame. */
  private progress = 0;
  private lastFrameAt = 0;
  private mouseRaw = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private hoverIndex = -1;

  private rafId: number | null = null;
  private disposed = false;
  /** Debounces the expensive wall-geometry rebuild in handleResize — see there. */
  private wallLayoutResizeTimeout: number | null = null;
  /**
   * Cached window.innerHeight, read fresh only on a settled (debounced)
   * resize — NOT on every animate() frame. Mobile browser chrome (the
   * address bar) animates the real viewport height DURING scroll itself;
   * reading it live inside readScrollProgress() meant the scroll-pixels
   * -> progress mapping's own denominator wobbled continuously while
   * scrolling, producing a small but real jitter in the derived `p` value
   * even when the user's actual scroll input was steady. The About
   * section's continuous, wide-range dive (see ABOUT_DIVE_DISTANCE) is far
   * more sensitive to small `p` changes than the corridor's distance-based
   * curves (which saturate quickly and mask the same jitter), which is why
   * it only read as visible jitter there.
   */
  private cachedViewportHeight: number;
  /**
   * Cached `(pointer: fine)` match — touch devices have no hover concept, so
   * the per-frame raycast in updateHover is skipped entirely for them rather
   * than run every frame just to reliably miss (the pointer is never moved
   * off-screen by a touch gesture, since touch doesn't fire `mousemove`).
   * Click-to-inspect (focusAt) does its own independent raycast from the
   * click/tap coordinates, so it works on touch even though hover doesn't.
   */
  private hasFinePointer: boolean;
  private readonly finePointerQuery: MediaQueryList | null;

  constructor(options: JourneySceneOptions) {
    this.options = options;
    this.category = options.initialCategory;
    this.placeholder = createPlaceholderTexture();

    const { canvas } = options;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.cachedViewportHeight = window.innerHeight;
    const isMobileDevice = width < MOBILE_LAYOUT_MAX_WIDTH;

    this.finePointerQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: fine)")
        : null;
    this.hasFinePointer = this.finePointerQuery?.matches ?? !isMobileDevice;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        isMobileDevice ? PIXEL_RATIO_MAX_MOBILE : PIXEL_RATIO_MAX_DESKTOP,
      ),
    );
    this.renderer.setSize(width, height, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0a0a, 10, 40);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 80);
    this.camera.position.set(0, 0, 6);

    // Hero backdrop: one plane filling the frame, one tighter crop floating
    // nearer the camera so the two drift apart as the pointer moves.
    this.farMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1c,
      transparent: true,
      opacity: HERO_FAR_BASE_OPACITY,
    });
    this.farMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.farMaterial);
    this.farMesh.position.set(0, 0, -4);

    this.nearMaterial = new THREE.MeshBasicMaterial({
      color: 0x232326,
      transparent: true,
      opacity: HERO_NEAR_BASE_OPACITY,
    });
    // A second, different landscape print floating nearer the camera than the
    // full-bleed backdrop — the hero's two photo layers at different depths.
    this.nearMesh = new THREE.Mesh(
      planeForAspect(imageAspect(HERO_NEAR_SLOT_ID) ?? 1.6, 9.0),
      this.nearMaterial,
    );
    this.nearMesh.position.set(2.4, -0.6, -1);

    this.wallMeshes = Array.from({ length: WALL_PLANE_COUNT }, (_, index) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.placeholder },
          blur: { value: 0 },
          opacity: { value: 1 },
          tint: { value: new THREE.Color(1, 1, 1) },
        },
        transparent: true,
        vertexShader: BLUR_VERTEX_SHADER,
        fragmentShader: isMobileDevice
          ? BLUR_FRAGMENT_SHADER_MOBILE
          : BLUR_FRAGMENT_SHADER,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const state: WallMeshState = {
        index,
        vertical: 0,
        depth: 0,
        tiltX: 0,
        tiltY: 0,
        focusAmount: 0,
      };
      mesh.userData = state;
      return mesh;
      // Geometry (sized to each photo's own aspect) comes from
      // applyWallGeometry, deferred to loadWallTextures, which knows the
      // active category's photo aspects. Position/facing are live, set
      // every frame in updateWallMeshes relative to the current camera pose.
    });

    this.aboutMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1c,
      transparent: true,
      // Starts invisible — animate() fades it in via bookingBackdropOpacityAt
      // once the booking section actually starts (this print is the booking
      // backdrop only now; About's own visual is the field below).
      opacity: 0,
    });
    // Geometry matches the about portrait's aspect exactly — no crop.
    const aboutGeometry = planeForAspect(
      imageAspect(ABOUT_SLOT_ID) ?? 0.8,
      12.8,
    );
    this.aboutMesh = new THREE.Mesh(aboutGeometry, this.aboutMaterial);
    this.aboutMesh.position.set(-1.8, 0, -27);

    this.rimMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9a35b,
      transparent: true,
      opacity: 0,
    });
    const aboutSize = aboutGeometry.parameters;
    this.rimMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(aboutSize.width + 0.35, aboutSize.height + 0.35),
      this.rimMaterial,
    );
    this.rimMesh.position.copy(this.aboutMesh.position);
    this.rimMesh.position.z -= 0.06;

    // About section's own visual: a scattered field of background tiles,
    // reusing the SAME blur/tint shader as the corridor photos (tinted dark
    // here instead of white so they read as atmosphere, not foreground
    // photos). Positioned relative to the camera path every frame in
    // updateAboutField.
    this.aboutFieldMeshes = ABOUT_FIELD_TILES.map((spec, index) => {
      const slotId = ABOUT_FIELD_SLOT_IDS[index];
      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.placeholder },
          blur: { value: 0.12 + index * 0.035 },
          opacity: { value: 0 },
          tint: { value: ABOUT_FIELD_TINT },
        },
        transparent: true,
        vertexShader: BLUR_VERTEX_SHADER,
        fragmentShader: isMobileDevice
          ? BLUR_FRAGMENT_SHADER_MOBILE
          : BLUR_FRAGMENT_SHADER,
      });
      const geometry = planeForAspect(
        imageAspect(slotId) ?? 1.3,
        ABOUT_FIELD_TILE_AREA * spec.scale,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = spec;
      return mesh;
    });

    // Small drifting dots sharing the tile field's depth space — geometry
    // positions are rewritten every frame in updateAboutField (each point
    // has its own depth/lateral/vertical, so the Points object itself
    // can't just move as one rigid body).
    const particlePositions = new Float32Array(ABOUT_PARTICLE_COUNT * 3);
    const particleColors = new Float32Array(ABOUT_PARTICLE_COUNT * 3);
    const warmColor = new THREE.Color(0xc9a35b);
    const coolColor = new THREE.Color(0xf4f2ee);
    this.aboutParticleSeeds = Array.from(
      { length: ABOUT_PARTICLE_COUNT },
      (_, i) => ({
        lateral: (hash01(i * 3.1 + 1) - 0.5) * 10,
        vertical: (hash01(i * 5.7 + 2) - 0.5) * 6,
        depth: 1 + hash01(i * 7.3 + 3) * 9.5,
        driftSeed: hash01(i * 11.9 + 4) * 1000,
      }),
    );
    this.aboutParticleSeeds.forEach((seed, i) => {
      const color = coolColor.clone().lerp(warmColor, hash01(i * 13.7 + 5));
      particleColors[i * 3] = color.r;
      particleColors[i * 3 + 1] = color.g;
      particleColors[i * 3 + 2] = color.b;
    });
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );
    particleGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(particleColors, 3),
    );
    this.aboutParticles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        size: isMobileDevice ? 0.05 : 0.06,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    this.scene.add(this.farMesh, this.nearMesh, this.aboutMesh, this.rimMesh);
    this.wallMeshes.forEach((mesh) => this.scene.add(mesh));
    this.aboutFieldMeshes.forEach((mesh) => this.scene.add(mesh));
    this.scene.add(this.aboutParticles);
  }

  start(): void {
    this.loadTexture(HERO_SLOT_ID, {
      planeAspect: this.camera.aspect,
      zoom: 1,
      apply: (t) => {
        this.farMaterial.map = t;
        this.farMaterial.needsUpdate = true;
      },
    });
    this.loadTexture(HERO_NEAR_SLOT_ID, {
      planeAspect:
        this.nearMesh.geometry instanceof THREE.PlaneGeometry
          ? this.nearMesh.geometry.parameters.width /
            this.nearMesh.geometry.parameters.height
          : 1.6,
      zoom: 1,
      apply: (t) => {
        this.nearMaterial.map = t;
        this.nearMaterial.needsUpdate = true;
      },
    });
    this.loadTexture(ABOUT_SLOT_ID, {
      planeAspect: imageAspect(ABOUT_SLOT_ID) ?? 0.8,
      zoom: 1,
      apply: (t) => {
        this.aboutMaterial.map = t;
        this.aboutMaterial.needsUpdate = true;
      },
    });
    this.aboutFieldMeshes.forEach((mesh, index) => {
      const slotId = ABOUT_FIELD_SLOT_IDS[index];
      const { width, height } = mesh.geometry.parameters;
      this.loadTexture(slotId, {
        planeAspect: width / height,
        zoom: 1,
        apply: (texture) => {
          mesh.material.uniforms.map.value = texture;
          mesh.material.needsUpdate = true;
        },
      });
    });
    this.loadWallTextures();

    this.sizeFarPlane();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handleMouseMove, {
      passive: true,
    });
    this.finePointerQuery?.addEventListener("change", this.handleFinePointerChange);

    this.options.onReady();
    this.rafId = requestAnimationFrame(this.animate);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.wallLayoutResizeTimeout !== null) {
      clearTimeout(this.wallLayoutResizeTimeout);
    }
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleMouseMove);
    this.finePointerQuery?.removeEventListener(
      "change",
      this.handleFinePointerChange,
    );

    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedTextures.clear();
    this.placeholder.dispose();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material as
          | THREE.Material
          | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });

    this.renderer.dispose();
  }

  /* ------------------------------ textures ------------------------------- */

  private loadTexture(
    slotId: string,
    opts: {
      planeAspect: number;
      zoom: number;
      apply: (texture: THREE.Texture) => void;
    },
  ): void {
    const source = imageSource(slotId);
    if (!source) {
      opts.apply(this.placeholder);
      return;
    }

    new THREE.TextureLoader().load(
      source,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        // sRGB decode + trilinear filtering + anisotropy so photos stay
        // crisp at the oblique angles the corridor planes sit at. (Pre-r152
        // three used `texture.encoding = sRGBEncoding` for the same thing.)
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        applyCoverFit(texture, opts.planeAspect, opts.zoom);
        this.ownedTextures.add(texture);
        opts.apply(texture);
      },
      undefined,
      () => opts.apply(this.placeholder),
    );
  }

  /* --------------------------- corridor layout ---------------------------- */

  /** Camera pose at a given progress, as vectors plus the forward/right/up frame. */
  private stationFrame(p: number) {
    const { pos, look } = this.interpolateCamera(p);
    const eye = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const target = new THREE.Vector3(look[0], look[1], look[2]);
    const forward = target.clone().sub(eye).normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    return { eye, forward, right, up };
  }

  /**
   * Sizes each of the six corridor planes to the active category's own
   * photo aspects, at the fixed field positions (PORTFOLIO_FIELD_DESKTOP/
   * MOBILE) shared by every category — no per-category composition, no
   * grouping. Does NOT set position/rotation — those are live, recomputed
   * every frame in updateWallMeshes relative to the current camera pose.
   */
  private applyWallGeometry(): void {
    const canvas = this.options.canvas;
    const viewW = canvas.clientWidth || window.innerWidth;
    const isMobile = viewW < MOBILE_LAYOUT_MAX_WIDTH;
    const field = isMobile ? PORTFOLIO_FIELD_MOBILE : PORTFOLIO_FIELD_DESKTOP;
    const area = isMobile
      ? PORTFOLIO_TILE_AREA_MOBILE
      : PORTFOLIO_TILE_AREA_DESKTOP;

    this.wallMeshes.forEach((mesh, index) => {
      const spec = field[index];
      const aspect = imageAspect(tileSlotId(this.category, index)) ?? 1.5;
      mesh.geometry.dispose();
      mesh.geometry = planeForAspect(aspect, area);
      const state = mesh.userData as WallMeshState;
      state.vertical = spec.vertical;
      state.depth = spec.depth;
    });
  }

  /**
   * Positions every corridor plane at its FIXED world position and drives
   * its blur/scale/opacity from its LIVE signed distance along the
   * camera's forward axis — see portfolioFocusAt. A clicked plane
   * (focusAmount > 0) blends toward a closer, larger "presented" pose on
   * top of that, without touching anything else.
   */
  private updateWallMeshes(sectionOpacity: number, dt: number): void {
    const eye = this.camera.position;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const wallFade = sectionOpacity * (1 - this.categorySwitchFade);
    // Half-height of the frustum at one world unit of distance — multiplying
    // by a mesh's true distance-from-camera gives the visible height budget
    // at that distance, used below to cap how large its sharp pose can grow.
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);

    this.wallMeshes.forEach((mesh) => {
      const state = mesh.userData as WallMeshState;
      // X pinned to the camera's own live X (not a fixed world value): the
      // camera path sweeps sideways through this band (CAMERA_KEYFRAMES),
      // so a photo fixed in world X would appear to slide toward an edge
      // as the camera swung, however it was placed. Depth (Z) stays a
      // genuinely fixed world position, which is what produces the
      // approach/pass-through motion as the camera dollies through it — Y
      // keeps its small hand-placed offset so consecutive photos don't
      // stack exactly on top of one another, but X is never anything but
      // "dead ahead of the camera."
      mesh.position.set(eye.x, eye.y + state.vertical, state.depth);

      const toMesh = this.scratchVec3.copy(mesh.position).sub(eye);
      const localDepth = toMesh.dot(forward);
      const trueDistance = toMesh.length();
      const { blur, scale, opacity } = portfolioFocusAt(localDepth);

      // See FIELD_MAX_SCREEN_FILL: bounds the ambient (non-focused) scale so
      // a close fly-by can't blow the photo up past a comfortable size,
      // however tight PORTFOLIO_FIELD_DESKTOP/MOBILE happens to place it
      // relative to the camera's path at that moment.
      const planeHeight = mesh.geometry.parameters.height;
      const maxVisibleHeight = 2 * halfFovTan * trueDistance * FIELD_MAX_SCREEN_FILL;
      const cappedScale = Math.min(scale, maxVisibleHeight / planeHeight);

      const targetFocus = state.index === this.focusedIndex ? 1 : 0;
      state.focusAmount +=
        (targetFocus - state.focusAmount) * (1 - Math.exp(-dt * 10));

      if (state.focusAmount > 0.001) {
        const presented = eye
          .clone()
          .addScaledVector(forward, FOCUS_PRESENT_DEPTH);
        mesh.position.lerp(presented, state.focusAmount);
      }
      // Screen-aligned (parallel to the camera's own image plane), NOT
      // mesh.lookAt(eye) (which faces the camera's POSITION instead of its
      // VIEW DIRECTION) — lookAt is correct for something dead-centre, but
      // for a photo close to the camera and off to one side, "facing the
      // camera position" tilts it away from the camera's actual image
      // plane, and perspective projects that tilt as real keystone/skew
      // distortion (a rectangle rendering as a distorted quadrilateral,
      // worst at close range with a lateral offset — exactly this corridor's
      // close, off-centre passes). Copying the camera's own orientation
      // keeps every photo a clean, undistorted rectangle at any distance.
      mesh.quaternion.copy(this.camera.quaternion);
      if (state.tiltX) mesh.rotateX(state.tiltX);
      if (state.tiltY) mesh.rotateY(state.tiltY);

      const finalScale = THREE.MathUtils.lerp(
        cappedScale,
        FOCUS_PRESENT_SCALE,
        state.focusAmount,
      );
      mesh.scale.setScalar(finalScale);

      const uniforms = mesh.material.uniforms;
      uniforms.blur.value = THREE.MathUtils.lerp(blur, 0, state.focusAmount);
      // Section-level fade (ROOT CAUSE fix): a plane only ever renders
      // opaque while the portfolio section is actually active. The
      // corridor's own distance-based opacity and the focus blend both
      // compose with it rather than either clobbering the other.
      uniforms.opacity.value =
        THREE.MathUtils.lerp(opacity, 1, state.focusAmount) * wallFade;
    });
  }

  /**
   * Positions and fades the About section's tile field + particles —
   * mirrors updateWallMeshes's pattern (recomputed every frame relative to
   * the LIVE camera pose via stationFrame) but with no per-station
   * push/blur math: these aren't sequential moments, they're a persistent
   * field the camera dives through continuously (see aboutDiveIntensityAt),
   * so a tile's only per-frame state is its section-opacity fade and a
   * small blur boost while the dive is active.
   */
  private updateAboutField(p: number): void {
    const canvas = this.options.canvas;
    const isMobile =
      (canvas.clientWidth || window.innerWidth) < MOBILE_LAYOUT_MAX_WIDTH;
    const activeTileCount = isMobile
      ? ABOUT_FIELD_TILE_COUNT_MOBILE
      : ABOUT_FIELD_TILE_COUNT_DESKTOP;
    const sectionOpacity = aboutFieldOpacityAt(p);
    const diveIntensity = aboutDiveIntensityAt(p);
    const { eye, forward, right, up } = this.stationFrame(p);
    // ROOT CAUSE fix — see ABOUT_FIELD_LATERAL_REFERENCE_ASPECT: `lateral`'s
    // world-unit magnitudes were tuned for a desktop-ish aspect ratio; a
    // narrower viewport (mobile portrait) has a proportionally narrower
    // frustum at any given depth, so the same offset that sits inside the
    // frame on desktop lands entirely outside it on mobile. Scaling by the
    // live camera aspect keeps every tile at the same fractional position
    // within whatever frustum width the current viewport actually has.
    // Clamped to 1 so wider-than-reference (ultrawide) viewports don't push
    // tiles further out than the hand-tuned desktop composition intended.
    const lateralScale = Math.min(
      1,
      this.camera.aspect / ABOUT_FIELD_LATERAL_REFERENCE_ASPECT,
    );

    this.aboutFieldMeshes.forEach((mesh, index) => {
      const spec = ABOUT_FIELD_TILES[index];
      // `right*lateral` intentionally present here — see AboutFieldTileSpec's
      // `lateral` doc comment. Depth still does all the approach motion;
      // lateral only shifts where along the frame that approach happens.
      mesh.position
        .copy(eye)
        .addScaledVector(forward, spec.depth)
        .addScaledVector(right, spec.lateral * lateralScale)
        .addScaledVector(up, spec.vertical);
      // Screen-aligned, not lookAt(eye) — see the identical fix and comment
      // in updateWallMeshes; the About dive can bring a tile close enough
      // to the camera for the same keystone risk.
      mesh.quaternion.copy(this.camera.quaternion);
      mesh.rotateZ(THREE.MathUtils.degToRad(spec.rotationDeg));

      const active = index < activeTileCount;
      mesh.material.uniforms.opacity.value = active
        ? sectionOpacity * ABOUT_FIELD_TILE_BASE_OPACITY
        : 0;
      mesh.material.uniforms.blur.value =
        0.12 + index * 0.035 + diveIntensity * 0.18;
    });

    const particleMaterial = this.aboutParticles
      .material as THREE.PointsMaterial;
    particleMaterial.opacity =
      aboutParticlesOpacityAt(p) * ABOUT_PARTICLES_BASE_OPACITY;

    const positions = this.aboutParticles.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const now = Date.now();
    this.aboutParticleSeeds.forEach((seed, i) => {
      const driftLateral = Math.sin(now * 0.00012 + seed.driftSeed) * 0.4;
      const driftVertical = Math.cos(now * 0.00009 + seed.driftSeed) * 0.3;
      this.scratchVec3
        .copy(eye)
        .addScaledVector(forward, seed.depth)
        .addScaledVector(right, seed.lateral + driftLateral)
        .addScaledVector(up, seed.vertical + driftVertical);
      positions.setXYZ(
        i,
        this.scratchVec3.x,
        this.scratchVec3.y,
        this.scratchVec3.z,
      );
    });
    positions.needsUpdate = true;
  }

  private loadWallTextures(): void {
    // Size this category's planes to its own photo aspects first — textures
    // then map 1:1 with no crop or stretch.
    this.applyWallGeometry();

    this.wallMeshes.forEach((mesh, index) => {
      const slotId = tileSlotId(this.category, index);
      const { width, height } = (mesh.geometry as THREE.PlaneGeometry)
        .parameters;

      this.loadTexture(slotId, {
        planeAspect: width / height,
        zoom: 1,
        apply: (texture) => {
          mesh.material.uniforms.map.value = texture;
          mesh.material.needsUpdate = true;
        },
      });
    });
  }

  /**
   * Fades the whole corridor out, swaps in the new category's textures,
   * fades it back in. `commit` fires at the midpoint so React state flips
   * while the corridor is fully hidden — a time-driven rise-then-fall pulse
   * (categorySwitchFade, consumed by updateWallMeshes) rather than
   * scroll-driven, since switching tabs is a click, not a scroll gesture.
   * Any active click-focus is dropped so it can't survive into the new
   * category's photos.
   */
  transitionCategory(next: CategoryId, commit: () => void): void {
    if (next === this.category) return;
    this.focusedIndex = -1;

    const start = performance.now();
    let swapped = false;

    const step = (now: number) => {
      if (this.disposed) return;
      const t = clamp01((now - start) / CATEGORY_SWITCH_DURATION);
      const rise = t < 0.5;
      const half = rise ? t * 2 : (1 - t) * 2;
      this.categorySwitchFade = smoothstep(0, 1, half);

      if (!swapped && t >= 0.5) {
        swapped = true;
        this.category = next;
        commit();
        this.loadWallTextures();
      }

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.categorySwitchFade = 0;
      }
    };

    requestAnimationFrame(step);
  }

  /** Keeps the scene's notion of the active category in sync with React. */
  syncCategory(next: CategoryId): void {
    if (next === this.category) return;
    this.focusedIndex = -1;
    this.category = next;
    this.loadWallTextures();
  }

  /* ------------------------------- input --------------------------------- */

  private handleMouseMove = (event: MouseEvent) => {
    this.mouseRaw.x = event.clientX / window.innerWidth - 0.5;
    this.mouseRaw.y = event.clientY / window.innerHeight - 0.5;
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1),
    );
  };

  /** Covers a device rotation or an external pointing device being attached/removed mid-session. */
  private handleFinePointerChange = (event: MediaQueryListEvent) => {
    this.hasFinePointer = event.matches;
  };

  private handleResize = () => {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    // Cheap, correctness-critical updates run on every resize event —
    // otherwise the frustum would be visibly wrong for a frame or two.
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sizeFarPlane();

    // applyWallGeometry() is NOT cheap — it disposes and rebuilds geometry
    // for every corridor plane. Mobile browsers fire `resize` as the
    // address bar animates in/out, which happens mid-SCROLL (scrolling down
    // hides it), so an undebounced rebuild here landed a synchronous
    // geometry rebuild in the middle of a scroll gesture. Debouncing
    // collapses a burst of resize events (address-bar animation, or a
    // drag-resize on desktop) into a single rebuild once things settle,
    // instead of one per event.
    if (this.wallLayoutResizeTimeout !== null) {
      clearTimeout(this.wallLayoutResizeTimeout);
    }
    this.wallLayoutResizeTimeout = window.setTimeout(() => {
      this.wallLayoutResizeTimeout = null;
      if (this.disposed) return;
      // Refreshed here (settled), not read live every frame — see
      // cachedViewportHeight.
      this.cachedViewportHeight = window.innerHeight;
      this.applyWallGeometry();
    }, 150);
  };

  /** Scales the backdrop plane so it always over-fills the frustum. */
  private sizeFarPlane(): void {
    const distance = 6 - this.farMesh.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * distance * 1.4;
    this.farMesh.scale.set(height * this.camera.aspect, height, 1);
  }

  /**
   * Click/tap-to-inspect: raycasts fresh from the given screen coordinates
   * (NOT from the hover-only `pointer`, which touch never moves) so this
   * works identically on desktop and touch. Brings the hit photo into a
   * closer, larger "presented" pose — see FOCUS_PRESENT_DEPTH and
   * updateWallMeshes — WITHOUT pausing or blocking the scroll-driven
   * corridor in any way; any further scroll drops it again (see animate).
   */
  focusAt(clientX: number, clientY: number): void {
    const [from, to] = PORTFOLIO_RANGE;
    if (this.progress < from || this.progress > to) return;

    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -((clientY / window.innerHeight) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.wallMeshes)[0];
    if (!hit) return;

    this.focusedIndex = hit.object.userData.index as number;
    this.focusedFromProgress = this.progress;
  }

  /* ----------------------------- render loop ----------------------------- */

  /**
   * Maps window scroll onto the journey's progress scale.
   *
   * The sticky track occupies 0 → `TRACK_PROGRESS_END`. Booking begins exactly
   * where the track ends (its top crosses the viewport bottom at that instant),
   * so it continues seamlessly from there up to `BOOKING_PROGRESS_END` rather
   * than the value saturating and the camera going static.
   */
  private readScrollProgress(): number {
    // cachedViewportHeight, not a live window.innerHeight read — see its
    // declaration for why (mobile address-bar jitter).
    const viewportHeight = this.cachedViewportHeight;
    const trackRect = this.options.track.getBoundingClientRect();
    const trackScrollable = trackRect.height - viewportHeight;
    const trackProgress =
      trackScrollable > 0 ? clamp01(-trackRect.top / trackScrollable) : 0;

    const booking = this.options.getBookingSection();
    if (!booking) return trackProgress;

    const rect = booking.getBoundingClientRect();
    if (rect.height <= 0) return trackProgress;

    // 0 as the section's top touches the viewport bottom, 1 once its bottom
    // has risen to the viewport bottom.
    const bookingLocal = clamp01(
      (viewportHeight - rect.top) / rect.height,
    );
    if (bookingLocal <= 0) return trackProgress;

    return (
      TRACK_PROGRESS_END +
      bookingLocal * (BOOKING_PROGRESS_END - TRACK_PROGRESS_END)
    );
  }

  private interpolateCamera(p: number) {
    const keyframes = CAMERA_KEYFRAMES;
    let i = 0;
    while (i < keyframes.length - 2 && p > keyframes[i + 1].p) i++;

    const a = keyframes[i];
    const b = keyframes[i + 1];
    const span = b.p - a.p;
    const t = span > 0 ? clamp01((p - a.p) / span) : 0;
    const e = smoothstep(0, 1, t);

    const lerp3 = (from: readonly number[], to: readonly number[]) =>
      [
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
        from[2] + (to[2] - from[2]) * e,
      ] as const;

    return { pos: lerp3(a.pos, b.pos), look: lerp3(a.look, b.look) };
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    // Advance Lenis FIRST — it owns the native scroll position now (see
    // scroll.ts), so readScrollProgress()'s getBoundingClientRect() reads
    // must happen after this frame's Lenis update, not before it.
    this.options.tickLenis();

    const raw = this.readScrollProgress();
    // Lenis is now the PRIMARY smoothing layer: it delivers an already-eased
    // scroll position (touch included, via syncTouch — see initLenis), so
    // this chase is no longer absorbing raw native-scroll burstiness the
    // way it used to. It's kept only as a light safety net (Lenis not yet
    // initialized on the very first frame or two, a stray large jump) —
    // deliberately snappier than before so it doesn't add a second layer of
    // lag on top of Lenis's own easing, which would read as sluggish input
    // response rather than a smooth glide.
    const frameNow = performance.now();
    const dt = this.lastFrameAt
      ? Math.min((frameNow - this.lastFrameAt) / 1000, 0.25)
      : 1 / 60;
    this.lastFrameAt = frameNow;
    this.progress += (raw - this.progress) * (1 - Math.exp(-dt * 12));
    const p = this.progress;
    // 0 → 1 across the booking section; 0 everywhere before it.
    const bookingLocal = clamp01(
      (p - TRACK_PROGRESS_END) / (BOOKING_PROGRESS_END - TRACK_PROGRESS_END),
    );

    // A click-focused photo is dismissed the moment the user scrolls again
    // — no explicit close, nothing that blocks the dive: the dive itself
    // never paused in the first place (the camera path below is driven by
    // `p` exactly as always), this only stops re-presenting the photo.
    if (
      this.focusedIndex >= 0 &&
      Math.abs(p - this.focusedFromProgress) > FOCUS_DISMISS_EPSILON
    ) {
      this.focusedIndex = -1;
    }

    this.mouseSmooth.x += (this.mouseRaw.x - this.mouseSmooth.x) * 0.05;
    this.mouseSmooth.y += (this.mouseRaw.y - this.mouseSmooth.y) * 0.05;

    const drift = this.options.parallaxIntensity;
    const offsetX = this.mouseSmooth.x * drift * 2.2;
    const offsetY = -this.mouseSmooth.y * drift * 1.6;

    const cam = this.interpolateCamera(p);
    // About's depth dive: dolly eye AND look-target forward together by the
    // same amount, along the CURRENT forward direction, so viewing direction
    // and FOV stay fixed and it reads as flying forward through space, not a
    // zoom. The portfolio corridor needs no such synthetic term — its
    // photos sit at fixed world positions and the camera's own existing
    // path already carries it past them continuously (see updateWallMeshes).
    const camPos = new THREE.Vector3(cam.pos[0], cam.pos[1], cam.pos[2]);
    const camLook = new THREE.Vector3(cam.look[0], cam.look[1], cam.look[2]);
    const camForward = camLook.clone().sub(camPos).normalize();
    const diveOffset = aboutDiveIntensityAt(p) * ABOUT_DIVE_DISTANCE;
    camPos.addScaledVector(camForward, diveOffset);
    camLook.addScaledVector(camForward, diveOffset);

    this.camera.position.set(
      camPos.x + offsetX,
      camPos.y + offsetY,
      camPos.z,
    );
    this.camera.lookAt(
      camLook.x + offsetX * 0.5,
      camLook.y + offsetY * 0.5,
      camLook.z,
    );

    const now = Date.now();
    const idleSway = Math.sin(now * 0.00015) * 0.025;
    this.farMesh.rotation.y = this.mouseSmooth.x * 0.05 + idleSway;
    this.nearMesh.rotation.y =
      this.mouseSmooth.x * 0.12 - 0.05 + idleSway * 1.4;
    this.nearMesh.position.y = -0.6 + Math.sin(now * 0.0004) * 0.05;

    // ROOT CAUSE fix: the hero's two photo layers now actually fade out as
    // the section is left, instead of just receding out of the frustum —
    // depth/fog alone left a faint ghost readable behind later sections.
    const heroMeshOpacity = heroOpacityAt(p);
    this.farMaterial.opacity = HERO_FAR_BASE_OPACITY * heroMeshOpacity;
    this.nearMaterial.opacity = HERO_NEAR_BASE_OPACITY * heroMeshOpacity;

    // The about plane is the only backdrop still in front of the camera by the
    // time booking is on screen, so it carries the visible drift. Through
    // booking the motion is driven by scroll position, not by the clock — the
    // idle sway stays only as a low-amplitude term so it never reads as frozen
    // when the page is still.
    const aboutLocal = smoothstep(0.6, 0.9, p);
    const bookingEase = smoothstep(0, 1, bookingLocal);

    // This print now exists ONLY as the booking backdrop (About's own
    // visual is the tile field in updateAboutField) — its entrance (fade +
    // slight scale + drift from depth) is keyed off bookingLocal, so it
    // stays cleared through the whole About section and only animates in
    // once booking actually starts.
    const backdropEntrance = bookingBackdropOpacityAt(bookingLocal);
    this.aboutMaterial.opacity = backdropEntrance;
    this.aboutMesh.scale.setScalar(
      BOOKING_BACKDROP_SCALE_START +
        (1 - BOOKING_BACKDROP_SCALE_START) * backdropEntrance,
    );

    this.aboutMesh.rotation.y =
      Math.sin(now * 0.0003) * 0.05 +
      (aboutLocal - 0.5) * 0.12 +
      bookingEase * 0.5;
    this.aboutMesh.rotation.x =
      Math.cos(now * 0.00025) * 0.03 - bookingEase * 0.18;
    this.aboutMesh.position.x = -1.8 + bookingEase * 2.6;
    this.aboutMesh.position.y = bookingEase * -1.05;
    this.aboutMesh.position.z =
      -27 +
      bookingEase * 1.6 +
      (1 - backdropEntrance) * BOOKING_BACKDROP_DEPTH_DRIFT;

    // The gold frame rides with the plane and only exists during booking.
    // Its brightness is what makes the drift visible against the scrim; the
    // dark print face alone has ~2 RGB units of contrast and reads as static.
    this.rimMesh.position.set(
      this.aboutMesh.position.x,
      this.aboutMesh.position.y,
      this.aboutMesh.position.z - 0.06,
    );
    this.rimMesh.rotation.copy(this.aboutMesh.rotation);
    this.rimMaterial.opacity = bookingEase * 0.85;
    // Lift the print face itself as booking progresses, so a real photograph
    // (once supplied) brightens with the frame instead of staying a hole.
    this.aboutMaterial.color.setHex(0x1a1a1c).lerp(RIM_LIT_TINT, bookingEase);

    // Corridor planes are positioned fresh every frame from the live camera
    // (their WORLD position is fixed, but rendering needs the current
    // camera to face/scale/blur them against) — must happen before hover
    // raycasting (which needs current positions) and before the tilt in
    // updateHover applies its ON TOP of this frame's freshly-computed facing.
    this.updateWallMeshes(portfolioOpacityAt(p), dt);
    this.updateAboutField(p);
    this.updateHover();
    this.updateOverlays(p);

    this.renderer.render(this.scene, this.camera);
  };

  private updateHover(): void {
    const [from, to] = PORTFOLIO_RANGE;
    const inRange = this.progress > from && this.progress < to;

    // Touch has no hover concept, and `pointer` is only ever moved by a real
    // `mousemove` event (which touch doesn't fire) — so on touch this ray
    // would reliably miss anyway, but intersectObjects still does the
    // ray-vs-6-planes work every single frame for zero payoff. Skip it
    // outright rather than run it to fail. Click-to-inspect (focusAt) does
    // its own independent raycast, so touch taps still work without this.
    let hits: THREE.Intersection[] = [];
    if (inRange && this.hasFinePointer) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      hits = this.raycaster.intersectObjects(this.wallMeshes);
    }
    const hit = hits[0];
    const hitIndex = hit ? (hit.object.userData.index as number) : -1;

    if (hitIndex !== this.hoverIndex) {
      this.hoverIndex = hitIndex;
      const captions = getCategory(this.category).captions;
      this.options.onHoverChange(
        hitIndex,
        hitIndex >= 0 ? captions[hitIndex] : "",
      );
    }

    this.wallMeshes.forEach((mesh) => {
      const isHit = hit?.object === mesh;
      const state = mesh.userData as WallMeshState;

      // The hovered plane tips toward the cursor's position within it. This
      // is a SMOOTHED LOCAL tilt, not a target for mesh.rotation directly —
      // updateWallMeshes already set the base facing this frame via lookAt,
      // so the tilt is applied as a small additional rotation there, fresh
      // each frame rather than accumulated.
      let targetTiltX = 0;
      let targetTiltY = 0;
      if (isHit && hit.uv) {
        targetTiltX = (hit.uv.y - 0.5) * -0.35;
        targetTiltY = (hit.uv.x - 0.5) * 0.5;
      }
      state.tiltX += (targetTiltX - state.tiltX) * 0.08;
      state.tiltY += (targetTiltY - state.tiltY) * 0.08;
    });
  }

  /**
   * Cross-fades the HTML overlays against camera progress. Written straight to
   * the DOM — running this through React state would mean a render per frame.
   */
  private updateOverlays(p: number): void {
    const overlays = this.options.getOverlays();

    const heroOpacity = heroOpacityAt(p);
    const portfolioOpacity = portfolioOpacityAt(p);
    const aboutOpacity = aboutTextOpacityAt(p);
    // The canvas dims only slightly through booking — the backdrop has to
    // keep reading through the section's scrim for its motion to be visible.
    const canvasOpacity = 1 - smoothstep(0.95, 1.08, p) * 0.2;

    if (overlays.hero) {
      overlays.hero.style.opacity = String(heroOpacity);
      overlays.hero.style.transform = `translateY(${(1 - heroOpacity) * 24}px)`;
    }
    if (overlays.scrollCue) {
      overlays.scrollCue.style.opacity = String(heroOpacity);
    }
    if (overlays.portfolio) {
      overlays.portfolio.style.opacity = String(portfolioOpacity);
      overlays.portfolio.style.pointerEvents =
        portfolioOpacity > 0.5 ? "auto" : "none";
    }
    if (overlays.portfolioCaption) {
      overlays.portfolioCaption.style.opacity = String(portfolioOpacity);
    }
    if (overlays.about) {
      overlays.about.style.opacity = String(aboutOpacity);
      // .journeyAbout is centered via flex now (see the CSS), not
      // transform — this is purely the entrance slide, not a positioning
      // transform, so it no longer needs to replicate any centering.
      overlays.about.style.transform = `translateX(${
        (1 - aboutOpacity) * 18
      }px)`;
    }
    if (overlays.handoff) {
      overlays.handoff.style.opacity = String(handoffOpacityAt(p));
    }
    this.options.canvas.style.opacity = String(canvasOpacity);
  }
}
