import Lenis from "lenis";

export const SCENE_TRACK_ID = "scene-track";
export const BOOKING_SECTION_ID = "booking";

/** Scroll progress the camera reaches at each named stop on the 3D journey. */
export const WAYPOINTS = {
  portfolio: 0.3,
  about: 0.67,
} as const;

/**
 * Single page-level Lenis instance. Owned here (not by any one component)
 * because both the 3D journey's camera AND the booking section's own
 * `--section-progress` motion, AND these nav-triggered scrollTo helpers,
 * all need to agree on one smoothed scroll source rather than each reading
 * raw native scroll independently.
 *
 * Only created for the immersive (WebGL + full-motion) experience — see
 * Journey.tsx, which calls initLenis()/disposeLenis() from its mount
 * effect. Flat mode and reduced-motion visitors never get it, so native
 * scroll (and the `behavior: "smooth"` fallback below) is exactly what
 * they've always gotten.
 */
let lenis: Lenis | null = null;

/**
 * How much native scroll-input distance (wheel, trackpad, or touch drag) it
 * takes to move the camera through the 3D journey, relative to Lenis's
 * defaults (`wheelMultiplier`/`touchMultiplier` of 1 each). One input unit
 * used to dive the camera roughly 3x further than felt controllable —
 * confirmed visually, two scroll ticks took a photo from barely-visible-in
 * -the-distance to filling the entire screen edge-to-edge. This is the
 * single knob for that: it scales Lenis's own delta multipliers, so wheel,
 * trackpad (both fire `wheel` events) and touch/momentum (via `syncTouch`,
 * which reads `touchMultiplier`) all slow down together. Re-tune here only —
 * nothing else converts scroll into camera travel (see
 * JourneyScene.readScrollProgress in scene.ts, which just reads Lenis's
 * already-scaled native scroll position).
 */
export const SCROLL_TO_DIVE_RATE = 1 / 3;

/**
 * Creates the page's Lenis instance if one doesn't already exist. Idempotent
 * — safe to call from an effect that might re-run.
 *
 * `syncTouch: true` is the one non-default option that actually matters for
 * the jank this exists to fix: Lenis's default (`syncTouch: false`) leaves
 * touch scrolling to the browser untouched and only smooths wheel input —
 * i.e. it would do nothing for the mobile momentum-scroll burstiness this
 * was added for. With it on, Lenis intercepts touch gestures too and drives
 * scroll with its own eased physics instead of relying on native momentum.
 * Trade-off worth knowing: this changes how touch scrolling FEELS (Lenis's
 * easing curve, not the OS's own momentum curve) — the standard trade every
 * Lenis+WebGL site makes, but worth confirming on a real phone rather than
 * assuming the defaults below are exactly right.
 */
export function initLenis(): Lenis {
  if (lenis) return lenis;
  lenis = new Lenis({
    duration: 1.1,
    syncTouch: true,
    wheelMultiplier: SCROLL_TO_DIVE_RATE,
    touchMultiplier: SCROLL_TO_DIVE_RATE,
  });
  return lenis;
}

export function getLenis(): Lenis | null {
  return lenis;
}

export function disposeLenis(): void {
  lenis?.destroy();
  lenis = null;
}

export function scrollToElement(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  if (lenis) {
    lenis.scrollTo(element, { duration: 1.2 });
    return;
  }
  window.scrollTo({ top: element.offsetTop, behavior: "smooth" });
}

/**
 * Scrolls to the point on the sticky track where the camera sits at
 * `progress` (0→1), so menu links can land on a moment in the 3D journey.
 */
export function scrollToWaypoint(progress: number): void {
  const track = document.getElementById(SCENE_TRACK_ID);
  if (!track) return;

  const rect = track.getBoundingClientRect();
  const trackTop = window.scrollY + rect.top;
  const scrollable = Math.max(rect.height - window.innerHeight, 0);
  const top = trackTop + scrollable * progress;

  // Native scrollTo (even the Lenis-absent fallback) fights Lenis's own
  // tracked target if called while it's active, so route through it
  // whenever it exists rather than only in the immersive-mode branch that
  // happens to call this — this function doesn't know its own caller.
  if (lenis) {
    lenis.scrollTo(top, { duration: 1.2 });
    return;
  }

  window.scrollTo({ top, behavior: "smooth" });
}
