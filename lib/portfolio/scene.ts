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

/* -------------------------------------------------------------------------- */
/* Moment layout                                                              */
/*                                                                            */
/* The six photographs are arranged as a SEQUENCE OF MOMENTS along the        */
/* existing camera path rather than a static scattered wall. Each moment is   */
/* placed on the camera's own look-ray at a fixed focus distance, at a chosen */
/* progress station — so when the visitor scrolls to that station, the        */
/* composition sits centred, fully in frame, facing the camera, and sharp.    */
/*                                                                            */
/* Stations are chosen so consecutive moments are separated along the path's  */
/* own travel (the early stations sit on the approach, the last on the exit   */
/* plunge): the camera passes THROUGH a spent moment, which exits behind it,  */
/* instead of leaving it parked beside the next composition. The existing     */
/* distance-blur then reads correctly for free — a moment is sharp only when  */
/* the camera is at its station, and the next moment ahead is strongly        */
/* blurred until approached. The camera path itself is untouched.             */
/* -------------------------------------------------------------------------- */

/** Focus distance from camera to a moment's centre plane. */
const FOCUS_DISTANCE_DESKTOP = 6;
const FOCUS_DISTANCE_MOBILE = 4.5;

/** Below this canvas CSS width, compose one photograph per moment. */
const MOBILE_LAYOUT_MAX_WIDTH = 700;

/**
 * Progress stations per moment count. Hand-placed against CAMERA_KEYFRAMES so
 * consecutive stations differ meaningfully in camera position — critically,
 * spanning segments where eye.z actually changes (approach: z 6→1.2→-8; exit:
 * z -8→-19→-24), not just the pure-pan segment (p 0.3-0.55), where eye.z is
 * PINNED at -8 and eye.x is the only thing moving. Two moments placed forward
 * of two same-z pan stations land at nearly the same depth, separated only by
 * the stations' eye.x delta — which is far smaller than the frustum's width
 * at a legible focus distance, so neighbouring moments occupy overlapping
 * screen space. Spreading stations across z-varying segments, PLUS a small
 * monotonic per-moment depth push below, keeps every moment's plane in its
 * own depth band regardless of how close two stations' eye.x happen to be.
 *
 * All stations also have to sit where the "Selected Work / The Portfolio"
 * heading is fully faded in: `portfolioOpacity` in updateOverlays only
 * reaches 1 for p ∈ (0.27, 0.57) — a station outside that window rests
 * while the heading (and the still-present, always-opaque hero backdrop
 * plane behind everything) is mid-crossfade, which reads as a washed-out,
 * low-contrast frame with ghosted title text. 2 (Portraits, verified) sits
 * right at that window's edge; every other count is kept inside it.
 *
 * Counts 1/2 are the values verified against the running build — do not
 * change them without re-checking Portraits at rest. 3/4/5/6 are for
 * Landscape/Weddings/Fashion-style sequences.
 */
const MOMENT_STATIONS: Record<number, number[]> = {
  1: [0.42],
  2: [0.26, 0.52],
  3: [0.3, 0.42, 0.54],
  4: [0.29, 0.38, 0.47, 0.555],
  5: [0.285, 0.355, 0.425, 0.495, 0.555],
  6: [0.28, 0.335, 0.39, 0.445, 0.5, 0.555],
};

/**
 * Splits a run of `runLength` same-orientation portrait images into groups
 * of 2 or 3 — never 1 (a stranded single wouldn't compose) — alternating
 * which size it reaches for first so the grouping isn't hard-locked to
 * always maxing out at 3. `preferThree` picks the opening size; a run that
 * doesn't divide evenly (leaving a remainder of 1) backs off to the other
 * size instead of forcing the max every time.
 */
function pickPortraitGroupSizes(
  runLength: number,
  preferThree: boolean,
): number[] {
  const sizes: number[] = [];
  let remaining = runLength;
  let big = preferThree;
  while (remaining > 0) {
    let take = Math.min(remaining, big ? 3 : 2);
    if (remaining - take === 1) {
      take = take === 3 ? 2 : Math.min(remaining, 3);
    }
    take = Math.min(Math.max(take, 2), remaining);
    sizes.push(take);
    remaining -= take;
    big = !big;
  }
  return sizes;
}

function stationsFor(count: number): number[] {
  return (
    MOMENT_STATIONS[count] ??
    Array.from(
      { length: count },
      (_, k) => 0.21 + (0.6 - 0.21) * (count === 1 ? 0.5 : k / (count - 1)),
    )
  );
}

/**
 * How each moment's planes are positioned, per frame, in `updateWallMeshes`:
 * NOT baked once into world space, but recomputed every frame relative to
 * the LIVE camera pose. At progress p, plane k sits at
 *   eye(p) + forward(p) * (D + depthOffsetBase + extraPush(|p - stationP_k|))
 *     + right(p) * lateral + up(p) * vertical
 * `extraPush` is 0 exactly at the plane's own station (so at rest the
 * composition is exactly what it was designed to be, always), and grows for
 * every OTHER moment simultaneously in view, receding and shrinking it out
 * of the way. This was the fix that actually held: baking each moment's
 * plane once at its own station's camera pose, then hoping distance-based
 * blur alone kept it out of the way from other stations, did not hold once
 * more than 2-3 moments needed to fit along the same short pan segment —
 * planes from every station ended up simultaneously inside the frustum,
 * fighting for the same screen space regardless of scroll position. Tying
 * position itself to (progress − station) makes "elsewhere" geometrically
 * impossible to confuse with "here."
 */
/**
 * Each moment now gets a genuine flat HOLD before push/blur even begin to
 * ramp — not just an eased curve starting the instant scroll moves off the
 * station. `|progress - stationP|` has to clear the PLATEAU width first
 * (extraPush/blur pinned at 0 the whole time); only past that does the
 * RAMP take over and pull the plane out of focus. Both are derived PER
 * LAYOUT from the actual gap between that layout's own stations (see
 * computeWallLayout), proportional to however much scroll room that layout
 * actually has between compositions — a count of 2 (Portraits, stations
 * 0.26 apart) gets a long hold; 5 stations packed into the same window
 * (Landscape) get a shorter one so neighbours never overlap. These
 * constants only bound the derived values.
 */
const MOMENT_PLATEAU_FACTOR = 0.3;
const MOMENT_PUSH_RAMP_FACTOR = 0.16;
const MOMENT_BLUR_RAMP_FACTOR = 0.13;
const MOMENT_PLATEAU_MIN = 0.014;
const MOMENT_PLATEAU_MAX = 0.22;
const MOMENT_PUSH_RAMP_MIN = 0.018;
const MOMENT_PUSH_RAMP_MAX = 0.11;
const MOMENT_BLUR_RAMP_MIN = 0.014;
const MOMENT_BLUR_RAMP_MAX = 0.09;
/** Dwell width to use when a layout has only one station (no gap to derive from). */
const MOMENT_RAMP_SOLO_GAP = 0.3;
const MOMENT_PUSH_MAX = 34;
/** How far off its own ray a fully-receded moment drifts — see parkLateral. */
const MOMENT_PARK_RADIUS = 2.6;
/**
 * Pulls every moment's resting position closer to the camera than its
 * sizing frustum (FOCUS_DISTANCE_*) alone would put it. Sizes are still
 * computed against the frustum at the plain focus distance — only the
 * PLACEMENT is pulled in — so the same world-size plane simply subtends a
 * bigger angle: closer and larger on screen, with every composition's own
 * internal depth stagger (triptych centre vs flanks, pair front vs back)
 * preserved exactly, just shifted as a unit.
 */
const MOMENT_REST_DEPTH_PULL = -1.3;

/**
 * Vertical keep-out for the fixed header plus the "The Portfolio" title/tab
 * block, in CSS pixels. Every moment's sizing budget is derived from the
 * frustum minus this band, so no plane can rest under the heading in any tab.
 */
const HEADER_KEEPOUT_PX = 185;

interface PlannedPlane {
  /** Tile index 0..5 within the category. */
  index: number;
  /** Progress at which this moment is fully composed (extraPush = 0). */
  stationP: number;
  /** Offsets from the moment's anchor, along the LIVE camera's own axes. */
  lateral: number;
  vertical: number;
  /** Added to the base focus distance along the live camera's forward axis. */
  depthOffsetBase: number;
  /**
   * Extra lateral/vertical drift blended in ONLY as the plane recedes (0 at
   * rest), unique per moment so that when several moments are simultaneously
   * "elsewhere", they part in different directions instead of converging on
   * the same point. Without this, every SINGLE-layout moment shares
   * lateral=0 — the composition's own centring — so multiple receded
   * singles landed on the exact same world position and stacked, several
   * translucent shader planes blending into one small but visible artifact
   * sitting wherever that shared point happened to project on screen.
   */
  parkLateral: number;
  parkVertical: number;
  width: number;
  height: number;
  /** Per-layout dwell plateau + ramp widths — see MOMENT_PLATEAU_FACTOR. */
  plateau: number;
  pushRamp: number;
  blurRamp: number;
}

/** Per-mesh animation state, read/written every frame — not React state. */
interface WallMeshState {
  index: number;
  stationP: number;
  lateral: number;
  vertical: number;
  depthOffsetBase: number;
  parkLateral: number;
  parkVertical: number;
  plateau: number;
  pushRamp: number;
  blurRamp: number;
  /** Category-switch swing rotation (radians), driven by transitionCategory. */
  swingY: number;
  /** Smoothed hover-tilt, applied as a small local rotation after facing. */
  tiltX: number;
  tiltY: number;
  /** |progress - stationP| from the last frame, reused by updateHover's blur. */
  progressDelta: number;
  /**
   * Category-swing opacity (0→1 during transitionCategory), separate from
   * the section-level opacity applied in updateWallMeshes so the two
   * multiply together instead of one clobbering the other.
   */
  transitionOpacity: number;
}

/**
 * Camera path through the scene, keyed to scroll progress (`p`, 0→1 across the
 * sticky track): push through the hero, sweep left across the wall, sweep
 * right, then continue into the About plane.
 */
/**
 * Journey progress is normalised so that 0 → 1 covers the sticky track (hero,
 * gallery wall, about). The booking section continues the same path beyond 1,
 * up to `BOOKING_PROGRESS_END`, so one scalar drives the whole page rather
 * than the camera stalling the moment the track runs out.
 */
const TRACK_PROGRESS_END = 1.0;
const BOOKING_PROGRESS_END = 1.4;

const CAMERA_KEYFRAMES = [
  { p: 0.0, pos: [0, 0, 6], look: [0, 0, -4] },
  { p: 0.16, pos: [0, 0, 1.2], look: [0, 0, -4] },
  { p: 0.3, pos: [-3.5, 0.2, -8], look: [-3.5, 0.2, -14] },
  { p: 0.55, pos: [3.5, 0.2, -8], look: [3.5, 0.2, -14] },
  { p: 0.64, pos: [0, 0.1, -19], look: [0, 0, -25] },
  { p: 0.85, pos: [1.4, 0.3, -24], look: [-1.8, 0, -27] },
  { p: 1.0, pos: [0, 0.15, -25], look: [-1, 0, -29] },
  // --- booking: the path continues past the sticky track, drifting down and
  // across so the backdrop keeps moving while the section is read. ---
  { p: 1.16, pos: [-1.05, -0.1, -26.5], look: [-1.7, -0.25, -30.4] },
  { p: 1.28, pos: [-0.2, -0.4, -27.4], look: [-0.4, -0.5, -31.2] },
  { p: BOOKING_PROGRESS_END, pos: [1.15, -0.72, -28.4], look: [0.4, -0.8, -32.1] },
] as const;

/** Scroll window in which the gallery wall is close enough to be hoverable. */
const PORTFOLIO_RANGE: readonly [number, number] = [0.18, 0.62];

/** Tint the about print brightens toward while the booking frame is lit. */
const RIM_LIT_TINT = new THREE.Color(0xcfc8b8);

/** Base (fully-active) opacities for the hero's two photo layers. */
const HERO_FAR_BASE_OPACITY = 0.96;
const HERO_NEAR_BASE_OPACITY = 0.98;

/**
 * The about portrait's entrance (ISSUE 2 fix): rather than sitting fully
 * visible in the scene the whole time portfolio is on screen, it drifts in
 * from slightly further back while scaling up and fading in, timed to
 * ABOUT_MESH_FADE_IN so it only starts once the portfolio wall has fully
 * cleared per the section-opacity fix above.
 */
const ABOUT_ENTRANCE_SCALE_START = 0.9;
const ABOUT_ENTRANCE_DEPTH_DRIFT = 1.4;

const BLUR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 5x5 box blur, used to fake depth-of-field on planes away from the camera. */
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float blur;
  uniform float opacity;
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
    gl_FragColor = vec4(c.rgb, c.a * opacity);
  }
`;

/** Chromatic-split wipe played over the whole viewport when a tile is opened. */
const WIPE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float t;
  varying vec2 vUv;
  void main() {
    float split = (1.0 - t) * 0.02;
    vec2 uv = vUv;
    float wipe = smoothstep(uv.x - 0.05, uv.x + 0.05, t * 1.2);
    float r = texture2D(map, uv + vec2(split, 0.0)).r;
    float g = texture2D(map, uv).g;
    float b = texture2D(map, uv - vec2(split, 0.0)).b;
    gl_FragColor = vec4(r, g, b, wipe);
  }
`;

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
const ABOUT_TEXT_FADE_OUT: readonly [number, number] = [0.9, 0.97];
/**
 * The about PHOTOGRAPH fades in across the same window as the about text,
 * but — unlike the text — never fades back out: the plane keeps drifting
 * through the booking section as its backdrop, so hiding it again where the
 * text exits would blank out booking's own visuals.
 */
const ABOUT_MESH_FADE_IN: readonly [number, number] = [0.64, 0.72];

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

function aboutMeshOpacityAt(p: number): number {
  return smoothstep(ABOUT_MESH_FADE_IN[0], ABOUT_MESH_FADE_IN[1], p);
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
}

export interface ClickTarget {
  index: number;
  texture: THREE.Texture | null;
}

export class JourneyScene {
  private readonly options: JourneySceneOptions;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-10, -10);

  private readonly farMaterial: THREE.MeshBasicMaterial;
  private readonly farMesh: THREE.Mesh;
  private readonly nearMaterial: THREE.MeshBasicMaterial;
  private readonly nearMesh: THREE.Mesh;
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
  private readonly wallMeshes: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  >[];

  private category: CategoryId;
  private ownedTextures = new Set<THREE.Texture>();
  private placeholder: THREE.CanvasTexture;
  /**
   * Bumped every time the active category actually changes. Seeds the
   * portrait group-size and landscape pair choices in computeWallLayout so
   * grouping isn't hard-locked to one fixed pattern (e.g. Portraits always
   * maxing to 3-3) — it's stable within a single view (no flicker on
   * resize) but varies across category switches.
   */
  private layoutVariant = 0;

  /** Smoothed scroll progress; the raw value is eased toward each frame. */
  private progress = 0;
  private lastFrameAt = 0;
  private mouseRaw = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private hoverIndex = -1;

  private rafId: number | null = null;
  private disposed = false;
  private wipeCanvas: HTMLCanvasElement | null = null;

  constructor(options: JourneySceneOptions) {
    this.options = options;
    this.category = options.initialCategory;
    this.placeholder = createPlaceholderTexture();

    const { canvas } = options;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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
        },
        transparent: true,
        vertexShader: BLUR_VERTEX_SHADER,
        fragmentShader: BLUR_FRAGMENT_SHADER,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const state: WallMeshState = {
        index,
        stationP: 0,
        lateral: 0,
        vertical: 0,
        depthOffsetBase: 0,
        parkLateral: 0,
        parkVertical: 0,
        plateau: MOMENT_PLATEAU_MIN,
        pushRamp: MOMENT_PUSH_RAMP_MIN,
        blurRamp: MOMENT_BLUR_RAMP_MIN,
        swingY: 0,
        tiltX: 0,
        tiltY: 0,
        progressDelta: 0,
        transitionOpacity: 1,
      };
      mesh.userData = state;
      return mesh;
      // Size and per-moment placement data come from applyWallLayout — the
      // actual world position/facing is set every frame in updateWallMeshes,
      // deferred to loadWallTextures, which knows the active category's
      // photo aspects.
    });

    this.aboutMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1c,
      transparent: true,
      // Starts invisible — animate() fades it in via ABOUT_MESH_FADE_IN,
      // only once the portfolio section has fully cleared (ISSUE 2).
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

    this.scene.add(this.farMesh, this.nearMesh, this.aboutMesh, this.rimMesh);
    this.wallMeshes.forEach((mesh) => this.scene.add(mesh));
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
    this.loadWallTextures();

    this.sizeFarPlane();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handleMouseMove, {
      passive: true,
    });

    this.options.onReady();
    this.rafId = requestAnimationFrame(this.animate);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleMouseMove);

    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedTextures.clear();
    this.placeholder.dispose();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as
          | THREE.Material
          | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });

    this.wipeCanvas?.remove();
    this.wipeCanvas = null;
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
        // crisp at the oblique angles the wall planes sit at. (Pre-r152
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

  /* --------------------------- moment layout ----------------------------- */

  /** Camera pose at a station, as vectors plus the forward/right/up frame. */
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
   * Plans the six planes as composed moments for the active category.
   * All sizes derive from the viewport frustum at the focus distance, so
   * compositions fit with margins on any screen and clear the fixed header.
   */
  private computeWallLayout(): PlannedPlane[] {
    const canvas = this.options.canvas;
    const viewW = canvas.clientWidth || window.innerWidth;
    const viewH = canvas.clientHeight || window.innerHeight;
    const viewAspect = viewW / viewH;
    const isMobile = viewW < MOBILE_LAYOUT_MAX_WIDTH;
    const D = isMobile ? FOCUS_DISTANCE_MOBILE : FOCUS_DISTANCE_DESKTOP;

    // Visible half-extents at the focus distance.
    const halfH = D * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * viewAspect;
    // Push compositions down into the band below the header/title block,
    // keeping clearance above the fold as well.
    const headerWorld = (HEADER_KEEPOUT_PX / viewH) * 2 * halfH;
    const dropY = -headerWorld * 0.42;
    /** Full usable height of the band below the exclusion zone. */
    const usableH = 2 * (halfH - headerWorld / 2);

    const aspects = Array.from({ length: WALL_PLANE_COUNT }, (_, i) =>
      imageAspect(tileSlotId(this.category, i)) ?? 1.5,
    );

    // Chunk into moments from each image's ACTUAL aspect ratio — never from
    // the category name, so backend-reassigned categories keep composing
    // correctly whatever mix of orientations they contain:
    //   run of ≥2 portrait-aspect images → duo/triptych (2-3, varied — see
    //                                      pickPortraitGroupSizes, not a
    //                                      hard-coded max-of-3 every time)
    //   landscape image                  → single (default) or an occasional
    //                                      side-by-side pair for variety
    //   lone portrait beside a landscape → mixed pair under landscape rules
    // Phones always compose one image per moment.
    const chunks: number[][] = [];
    if (isMobile) {
      aspects.forEach((_, i) => chunks.push([i]));
    } else {
      let i = 0;
      // At most ONE landscape-landscape pair per category — "occasional
      // variety" per the spec, not a 50/50 alternation. Everything else
      // landscape composes as a single. Whether this category even gets
      // that one pair alternates with layoutVariant, so landscape framing
      // isn't locked to the same pattern on every view either.
      let usedLandscapePair = this.layoutVariant % 2 === 1;
      while (i < WALL_PLANE_COUNT) {
        if (aspects[i] < 1) {
          let run = 1;
          while (i + run < WALL_PLANE_COUNT && aspects[i + run] < 1) {
            run++;
          }
          if (run >= 2) {
            // preferThree alternates with layoutVariant so a run doesn't
            // always resolve to the same fixed partition (e.g. a run of 6
            // can land as [3,3] or [2,2,2] depending on the seed).
            const preferThree = this.layoutVariant % 2 === 0;
            for (const size of pickPortraitGroupSizes(run, preferThree)) {
              chunks.push(
                Array.from({ length: size }, (_, offset) => i + offset),
              );
              i += size;
            }
          } else if (i + 1 < WALL_PLANE_COUNT) {
            // Lone portrait beside whatever comes next → mixed pair.
            chunks.push([i, i + 1]);
            i += 2;
          } else {
            chunks.push([i]);
            i += 1;
          }
          continue;
        }

        const nextIsLandscape =
          i + 1 < WALL_PLANE_COUNT && aspects[i + 1] >= 1;
        const nextIsLonePortrait =
          i + 1 < WALL_PLANE_COUNT &&
          aspects[i + 1] < 1 &&
          !(i + 2 < WALL_PLANE_COUNT && aspects[i + 2] < 1);

        if (nextIsLandscape && !usedLandscapePair) {
          chunks.push([i, i + 1]);
          usedLandscapePair = true;
          i += 2;
        } else if (!nextIsLandscape && nextIsLonePortrait) {
          chunks.push([i, i + 1]);
          i += 2;
        } else {
          chunks.push([i]);
          i += 1;
        }
      }
    }

    const stations = stationsFor(chunks.length);
    // Derive this layout's dwell plateau + ramp from its own tightest
    // station gap — see the comment on MOMENT_PLATEAU_FACTOR.
    const minStationGap =
      stations.length > 1
        ? Math.min(
            ...stations.slice(1).map((s, i) => s - stations[i]),
          )
        : MOMENT_RAMP_SOLO_GAP;
    const plateau = Math.min(
      Math.max(minStationGap * MOMENT_PLATEAU_FACTOR, MOMENT_PLATEAU_MIN),
      MOMENT_PLATEAU_MAX,
    );
    const pushRamp = Math.min(
      Math.max(minStationGap * MOMENT_PUSH_RAMP_FACTOR, MOMENT_PUSH_RAMP_MIN),
      MOMENT_PUSH_RAMP_MAX,
    );
    const blurRamp = Math.min(
      Math.max(minStationGap * MOMENT_BLUR_RAMP_FACTOR, MOMENT_BLUR_RAMP_MIN),
      MOMENT_BLUR_RAMP_MAX,
    );
    const planes: PlannedPlane[] = [];

    chunks.forEach((chunk, k) => {
      const stationP = stations[k];
      // Distinct receding direction per MOMENT (shared by every plane in
      // it) so simultaneously-elsewhere moments fan out rather than
      // collapsing onto each other — see PlannedPlane.parkLateral.
      // Horizontal-only and alternating sides: a vertical component (an
      // earlier version used a full circular spread) could drift a receded
      // moment up into the header/title exclusion band or down past the
      // fold — purely lateral parking can't.
      const parkSide = k % 2 === 0 ? 1 : -1;
      const parkLateral =
        parkSide * (MOMENT_PARK_RADIUS + Math.floor(k / 2) * 2.1);
      const parkVertical = 0;

      // Sizing uses the plain focus-distance frustum (D) — every moment gets
      // an identical size budget. There's no longer a per-moment distance
      // fudge to compensate for: at rest each moment sits at exactly D plus
      // its own small within-composition depth offset, via updateWallMeshes.
      const place = (
        index: number,
        lateral: number,
        vertical: number,
        depth: number,
        width: number,
        height: number,
      ) => {
        planes.push({
          index,
          stationP,
          lateral,
          vertical: vertical + dropY,
          // MOMENT_REST_DEPTH_PULL brings every composition closer to camera
          // as a unit — each plane's own depth argument still sets its
          // within-composition stagger (triptych centre vs flanks, pair
          // front vs back) relative to the others, untouched.
          depthOffsetBase: depth + MOMENT_REST_DEPTH_PULL,
          parkLateral,
          parkVertical,
          width,
          height,
          plateau,
          pushRamp,
          blurRamp,
        });
      };

      if (chunk.length === 1) {
        // Single, centred in the below-header band: ~75% of viewport width
        // for a landscape, height-capped so every margin stays clear.
        const a = aspects[chunk[0]];
        let width = 2 * halfW * (isMobile ? 0.78 : 0.75);
        let height = width / a;
        const maxH = usableH * 0.84;
        if (height > maxH) {
          height = maxH;
          width = height * a;
        }
        place(chunk[0], 0, 0, 0, width, height);
      } else if (chunk.length === 3) {
        // Triptych: centre print slightly forward, flanks slightly behind.
        const [l, c, r] = chunk;
        const hC = usableH * 0.62;
        const wC = hC * aspects[c];
        const hF = hC * 0.82;
        const wL = hF * aspects[l];
        const wR = hF * aspects[r];
        const gap = 0.24;
        place(c, 0, 0, 0.28, wC, hC);
        place(l, -(wC / 2 + wL / 2 + gap), -0.06, -0.7, wL, hF);
        place(r, wC / 2 + wR / 2 + gap, -0.06, -0.7, wR, hF);
      } else if (aspects[chunk[0]] < 1 && aspects[chunk[1]] < 1) {
        // Portrait duo — same visual language as the triptych (one print
        // forward, one flanking behind), just with a single flank instead
        // of two, the pair centred as a unit. Was previously falling
        // through to the landscape "back larger / front smaller" pair
        // treatment, which is tuned for wide images and produced two small,
        // oddly-stacked prints for two tall ones.
        const [main, flank] = chunk;
        const hMain = usableH * 0.62;
        const wMain = hMain * aspects[main];
        const hFlank = hMain * 0.82;
        const wFlank = hFlank * aspects[flank];
        const gap = 0.24;
        const totalW = wMain + gap + wFlank;
        place(main, -totalW / 2 + wMain / 2, 0, 0.28, wMain, hMain);
        place(flank, totalW / 2 - wFlank / 2, -0.06, -0.7, wFlank, hFlank);
      } else if (aspects[chunk[0]] >= 1 && aspects[chunk[1]] >= 1) {
        // Two landscapes: symmetric side-by-side with a visible gap, each
        // ~40% of viewport width, and a small depth offset for parallax.
        const [first, second] = chunk;
        const gap = 0.45;
        const sized = chunk.map((index) => {
          let w = 2 * halfW * 0.4;
          let h = w / aspects[index];
          const maxH = usableH * 0.68;
          if (h > maxH) {
            h = maxH;
            w = h * aspects[index];
          }
          return { w, h };
        });
        place(
          first,
          -(sized[0].w / 2 + gap / 2),
          0.04,
          -0.45,
          sized[0].w,
          sized[0].h,
        );
        place(
          second,
          sized[1].w / 2 + gap / 2,
          -0.12,
          0.35,
          sized[1].w,
          sized[1].h,
        );
      } else {
        // Mixed pair (one landscape, one portrait): the more landscape image
        // larger and behind, the other smaller and nearer, offset to the
        // opposite side — per spec, a mixed moment uses the landscape rules.
        const [first, second] = chunk;
        const backIdx = aspects[first] >= aspects[second] ? first : second;
        const frontIdx = backIdx === first ? second : first;

        let wB = 2 * halfW * 0.42;
        let hB = wB / aspects[backIdx];
        const maxHB = usableH * 0.66;
        if (hB > maxHB) {
          hB = maxHB;
          wB = hB * aspects[backIdx];
        }
        let hF = usableH * 0.56;
        let wF = hF * aspects[frontIdx];
        const maxWF = 2 * halfW * 0.34;
        if (wF > maxWF) {
          wF = maxWF;
          hF = wF / aspects[frontIdx];
        }

        const lateralB = -(halfW * 0.26);
        const lateralF = halfW * 0.32;
        place(backIdx, lateralB, 0.12, -0.8, wB, hB);
        place(frontIdx, lateralF, -0.3, 0.45, wF, hF);
      }
    });

    return planes;
  }

  /**
   * Applies the planned layout to the meshes: geometry (size) and the
   * per-moment placement data `updateWallMeshes` reads every frame. Does NOT
   * set position/rotation — those are live, recomputed every frame relative
   * to the current camera pose.
   */
  private applyWallLayout(): void {
    const planned = this.computeWallLayout();
    for (const plan of planned) {
      const mesh = this.wallMeshes[plan.index];
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(plan.width, plan.height);
      const state = mesh.userData as WallMeshState;
      state.stationP = plan.stationP;
      state.lateral = plan.lateral;
      state.vertical = plan.vertical;
      state.depthOffsetBase = plan.depthOffsetBase;
      state.parkLateral = plan.parkLateral;
      state.parkVertical = plan.parkVertical;
      state.plateau = plan.plateau;
      state.pushRamp = plan.pushRamp;
      state.blurRamp = plan.blurRamp;
    }
  }

  /**
   * Positions and faces every wall plane for the CURRENT frame's progress —
   * see the comment on MOMENT_PUSH_RAMP for why this replaced baking each
   * plane's position once at its own station.
   */
  private updateWallMeshes(p: number, sectionOpacity: number): void {
    const canvas = this.options.canvas;
    const viewW = canvas.clientWidth || window.innerWidth;
    const D =
      viewW < MOBILE_LAYOUT_MAX_WIDTH
        ? FOCUS_DISTANCE_MOBILE
        : FOCUS_DISTANCE_DESKTOP;
    const { eye, forward, right, up } = this.stationFrame(p);

    this.wallMeshes.forEach((mesh) => {
      const state = mesh.userData as WallMeshState;
      const delta = p - state.stationP;
      // Flat hold first (see MOMENT_PLATEAU_FACTOR): only the scroll beyond
      // the plateau counts toward the push ramp, so the plane stays exactly
      // as composed for a real dwell period before it starts moving at all.
      const pastPlateau = Math.max(0, Math.abs(delta) - state.plateau);
      const t = clamp01(pastPlateau / state.pushRamp);
      const parkT = t * t; // ease-in, matches extraPush's own easing
      const extraPush = parkT * MOMENT_PUSH_MAX;
      const restDepth = D + state.depthOffsetBase;

      // Recede STRAIGHT BACK along the ray from the eye through this plane's
      // resting position — not just further along the shared forward axis.
      // Scaling only depth (forward) while lateral/vertical stayed fixed
      // made a receding plane's projected screen position slide toward
      // dead-centre as it moved away (angular position = lateral/depth, and
      // depth was growing while lateral held still). Scaling lateral/vertical
      // by the same ratio keeps the ray's direction constant as it shrinks —
      // but that alone isn't enough: every SINGLE-layout moment shares
      // lateral=0 (centred is centred), so multiple simultaneously-receded
      // singles still converged on each other's ray. parkLateral/Vertical
      // blends in a per-moment drift as it recedes (0 at rest) so they fan
      // out to different corners instead of stacking.
      const rayScale = restDepth > 0 ? (restDepth + extraPush) / restDepth : 1;
      const effLateral = state.lateral + parkT * state.parkLateral;
      const effVertical = state.vertical + parkT * state.parkVertical;

      mesh.position
        .copy(eye)
        .addScaledVector(forward, restDepth + extraPush)
        .addScaledVector(right, effLateral * rayScale)
        .addScaledVector(up, effVertical * rayScale);
      mesh.lookAt(eye);
      if (state.swingY) mesh.rotateY(state.swingY);

      // Section-level fade (ROOT CAUSE fix): a plane only ever renders
      // opaque while the portfolio section is actually active. Multiplied
      // with the category-swing opacity so the two compose instead of one
      // clobbering the other — see transitionCategory.
      mesh.material.uniforms.opacity.value =
        state.transitionOpacity * sectionOpacity;

      state.progressDelta = delta;
    });
  }

  private loadWallTextures(): void {
    // Compose this category's moments first — geometry aspect then matches
    // each photograph exactly, so textures map 1:1 with no crop or stretch.
    this.applyWallLayout();

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
   * Swings the wall out, swaps in the new category's textures, swings it back.
   * `commit` fires at the midpoint so React state flips while the wall is hidden.
   */
  transitionCategory(next: CategoryId, commit: () => void): void {
    if (next === this.category) return;
    this.layoutVariant++;

    const DURATION = 420;
    const swingOutStart = performance.now();

    // swingY is an ADDITIONAL local rotation applied on top of whatever
    // facing updateWallMeshes computes this frame — not a replacement for
    // it — so the swing plays correctly no matter where the camera is.
    const swingIn = (start: number) => {
      const step = (now: number) => {
        if (this.disposed) return;
        const k = Math.min((now - start) / DURATION, 1);
        this.wallMeshes.forEach((mesh) => {
          const state = mesh.userData as WallMeshState;
          state.swingY = -(1 - k) * 1.1;
          state.transitionOpacity = k;
        });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const swingOut = (now: number) => {
      if (this.disposed) return;
      const k = Math.min((now - swingOutStart) / DURATION, 1);
      this.wallMeshes.forEach((mesh) => {
        const state = mesh.userData as WallMeshState;
        state.swingY = k * 1.1;
        state.transitionOpacity = 1 - k;
      });

      if (k < 1) {
        requestAnimationFrame(swingOut);
        return;
      }

      this.category = next;
      commit();
      this.loadWallTextures();
      swingIn(performance.now());
    };

    requestAnimationFrame(swingOut);
  }

  /** Keeps the scene's notion of the active category in sync with React. */
  syncCategory(next: CategoryId): void {
    if (next === this.category) return;
    this.layoutVariant++;
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

  private handleResize = () => {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sizeFarPlane();
    // Recompose the moments for the new viewport shape (and possibly a
    // different desktop/mobile grouping).
    this.applyWallLayout();
  };

  /** Scales the backdrop plane so it always over-fills the frustum. */
  private sizeFarPlane(): void {
    const distance = 6 - this.farMesh.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * distance * 1.4;
    this.farMesh.scale.set(height * this.camera.aspect, height, 1);
  }

  /**
   * The tile currently under the pointer, or null when the wall isn't in
   * range. Returns the live texture so the caller can play a wipe from it.
   */
  getClickTarget(): ClickTarget | null {
    if (this.hoverIndex < 0) return null;
    const [from, to] = PORTFOLIO_RANGE;
    if (this.progress < from || this.progress > to) return null;

    const mesh = this.wallMeshes[this.hoverIndex];
    return {
      index: this.hoverIndex,
      texture: (mesh?.material.uniforms.map.value as THREE.Texture) ?? null,
    };
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
    const trackRect = this.options.track.getBoundingClientRect();
    const trackScrollable = trackRect.height - window.innerHeight;
    const trackProgress =
      trackScrollable > 0 ? clamp01(-trackRect.top / trackScrollable) : 0;

    const booking = this.options.getBookingSection();
    if (!booking) return trackProgress;

    const rect = booking.getBoundingClientRect();
    if (rect.height <= 0) return trackProgress;

    // 0 as the section's top touches the viewport bottom, 1 once its bottom
    // has risen to the viewport bottom.
    const bookingLocal = clamp01(
      (window.innerHeight - rect.top) / rect.height,
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

    const raw = this.readScrollProgress();
    // Ease toward the true scroll position so the camera glides rather than
    // snaps. Frame-rate independent: at 60fps this is the classic 0.09/frame
    // chase, but a throttled tab (occluded window, background) still
    // converges instead of crawling one tiny step per sparse callback.
    const frameNow = performance.now();
    const dt = this.lastFrameAt
      ? Math.min((frameNow - this.lastFrameAt) / 1000, 0.25)
      : 1 / 60;
    this.lastFrameAt = frameNow;
    this.progress += (raw - this.progress) * (1 - Math.exp(-dt * 5.65));
    const p = this.progress;
    // 0 → 1 across the booking section; 0 everywhere before it.
    const bookingLocal = clamp01(
      (p - TRACK_PROGRESS_END) / (BOOKING_PROGRESS_END - TRACK_PROGRESS_END),
    );

    this.mouseSmooth.x += (this.mouseRaw.x - this.mouseSmooth.x) * 0.05;
    this.mouseSmooth.y += (this.mouseRaw.y - this.mouseSmooth.y) * 0.05;

    const drift = this.options.parallaxIntensity;
    const offsetX = this.mouseSmooth.x * drift * 2.2;
    const offsetY = -this.mouseSmooth.y * drift * 1.6;

    const cam = this.interpolateCamera(p);
    this.camera.position.set(
      cam.pos[0] + offsetX,
      cam.pos[1] + offsetY,
      cam.pos[2],
    );
    this.camera.lookAt(
      cam.look[0] + offsetX * 0.5,
      cam.look[1] + offsetY * 0.5,
      cam.look[2],
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

    // ISSUE 2 fix: the about portrait animates in (fade + slight scale +
    // drift from depth) once the portfolio wall has fully cleared, instead
    // of sitting fully visible in the scene the whole time portfolio is
    // being viewed. Shares ABOUT_MESH_FADE_IN with the opacity below so the
    // fade, scale, and depth drift all resolve together.
    const aboutEntrance = aboutMeshOpacityAt(p);
    this.aboutMaterial.opacity = aboutEntrance;
    this.aboutMesh.scale.setScalar(
      ABOUT_ENTRANCE_SCALE_START +
        (1 - ABOUT_ENTRANCE_SCALE_START) * aboutEntrance,
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
      -27 + bookingEase * 1.6 + (1 - aboutEntrance) * ABOUT_ENTRANCE_DEPTH_DRIFT;

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

    // Wall planes are positioned fresh every frame from the live camera —
    // must happen before hover raycasting (which needs current positions)
    // and before the tilt in updateHover applies its ON TOP of this frame's
    // freshly-computed facing.
    this.updateWallMeshes(p, portfolioOpacityAt(p));
    this.updateHover();
    this.updateOverlays(p);

    this.renderer.render(this.scene, this.camera);
  };

  private updateHover(): void {
    const [from, to] = PORTFOLIO_RANGE;
    const inRange = this.progress > from && this.progress < to;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = inRange ? this.raycaster.intersectObjects(this.wallMeshes) : [];
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
      // updateWallMeshes already set the base facing+swing this frame via
      // lookAt, so the tilt is applied as a small additional rotation on
      // top, fresh each frame rather than accumulated.
      let targetTiltX = 0;
      let targetTiltY = 0;
      if (isHit && hit.uv) {
        targetTiltX = (hit.uv.y - 0.5) * -0.35;
        targetTiltY = (hit.uv.x - 0.5) * 0.5;
      }
      state.tiltX += (targetTiltX - state.tiltX) * 0.08;
      state.tiltY += (targetTiltY - state.tiltY) * 0.08;
      if (state.tiltX) mesh.rotateX(state.tiltX);
      if (state.tiltY) mesh.rotateY(state.tiltY);

      // Sharp through the plateau around this plane's own moment (see
      // MOMENT_PLATEAU_FACTOR), blurred only once scroll has carried past
      // that hold in either direction.
      const pastPlateauBlur = Math.max(
        0,
        Math.abs(state.progressDelta) - state.plateau,
      );
      const tb = clamp01(pastPlateauBlur / state.blurRamp);
      const depthBlur = tb * tb * 0.55;
      const target = isHit ? 0 : depthBlur;
      const uniform = mesh.material.uniforms.blur;
      uniform.value += (target - uniform.value) * 0.1;
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
      overlays.about.style.transform = `translateY(-50%) translateX(${
        (1 - aboutOpacity) * 18
      }px)`;
    }
    this.options.canvas.style.opacity = String(canvasOpacity);
  }

  /* ------------------------------ wipe FX -------------------------------- */

  /**
   * Full-screen chromatic wipe from the clicked plane's texture, run on a
   * throwaway renderer so the main loop keeps its own state.
   */
  playRevealTransition(texture: THREE.Texture | null, onDone: () => void): void {
    if (!texture) {
      onDone();
      return;
    }

    if (!this.wipeCanvas) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText =
        "position:fixed;inset:0;z-index:500;pointer-events:none;width:100%;height:100%;";
      document.body.appendChild(canvas);
      this.wipeCanvas = canvas;
    }

    const canvas = this.wipeCanvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, t: { value: 0 } },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }",
      fragmentShader: WIPE_FRAGMENT_SHADER,
      transparent: true,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const start = performance.now();
    const DURATION = 480;

    const step = (now: number) => {
      const k = Math.min((now - start) / DURATION, 1);
      material.uniforms.t.value = k;
      renderer.render(scene, camera);

      if (k < 1) {
        requestAnimationFrame(step);
        return;
      }

      canvas.style.display = "none";
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      onDone();
    };

    requestAnimationFrame(step);
  }
}
