"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reveal-on-scroll. Returns a ref callback and whether the element has entered
 * the viewport; it latches on, so content never fades back out.
 *
 * `viewportFraction` is measured against the VIEWPORT, not the target
 * element's own height — done via a negative bottom `rootMargin` (shrinking
 * the effective intersection area up from the real viewport bottom) plus
 * `threshold: 0`, so reveal fires the instant the target crosses into that
 * shrunk area, rather than once a *fraction of the target's own height* is
 * visible.
 *
 * ROOT CAUSE this replaces: the previous `{ threshold: 0.15 }` measured
 * against the target's own total height. For a short element that's a small
 * absolute scroll distance, but for a tall one it demands proportionally
 * more real scroll before revealing anything — e.g. Booking's single-column
 * mobile layout (no room for its desktop grid, so cards/calendar/form stack
 * to ~3000px instead of a ~1200px, multi-column desktop render) needed 15%
 * of *that* — ~450px of real scroll — before any content even started its
 * opacity transition. Stacked on top of the sitewide 3x scroll-sensitivity
 * reduction (SCROLL_TO_DIVE_RATE), that read as several screens of blank
 * scrolling on mobile specifically, purely because the same element happens
 * to render far taller there. A viewport-relative margin costs the same
 * scroll distance to trigger regardless of how tall the target renders.
 */
export function useInView(viewportFraction = 0.15) {
  const [inView, setInView] = useState(false);
  const seen = useRef(false);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (!element || seen.current) return;

      if (typeof IntersectionObserver === "undefined") {
        seen.current = true;
        setInView(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          seen.current = true;
          setInView(true);
          observer.disconnect();
        },
        { threshold: 0, rootMargin: `0px 0px -${viewportFraction * 100}% 0px` },
      );
      observer.observe(element);

      return () => observer.disconnect();
    },
    [viewportFraction],
  );

  return [ref, inView] as const;
}

export type MotionPreference = "full" | "reduced";

const MOTION_STORAGE_KEY = "jd:motion";

function readOverride(): MotionPreference | null {
  const fromQuery = new URLSearchParams(window.location.search).get("motion");
  if (fromQuery === "full" || fromQuery === "reduced") {
    // Persist so the choice survives navigation without the query string.
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, fromQuery);
    } catch {
      /* private mode — the query param still applies to this page view */
    }
    return fromQuery;
  }

  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    if (stored === "full" || stored === "reduced") return stored;
  } catch {
    /* storage unavailable — fall through to the OS preference */
  }

  return null;
}

/**
 * Resolves how much motion to render.
 *
 * The OS `prefers-reduced-motion` setting is the *default*, not a lock: it is
 * frequently enabled for performance reasons (Windows turns it off with
 * "animation effects"), and silently withholding the 3D gallery from those
 * visitors with no way to ask for it is worse than offering the choice.
 *
 * Precedence: `?motion=full|reduced` → stored choice → OS preference.
 *
 * Returns `null` until mounted, so the caller can avoid committing to a
 * render path during SSR.
 */
export function useMotionPreference(): MotionPreference | null {
  const [preference, setPreference] = useState<MotionPreference | null>(null);

  useEffect(() => {
    const override = readOverride();
    if (override) {
      setPreference(override);
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPreference(query.matches ? "reduced" : "full");

    const onChange = (event: MediaQueryListEvent) =>
      setPreference(event.matches ? "reduced" : "full");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return preference;
}

/** True on devices with a mouse or trackpad — gates the custom cursor. */
export function useHasFinePointer(): boolean {
  const [fine, setFine] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    setFine(query.matches);

    const onChange = (event: MediaQueryListEvent) => setFine(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return fine;
}

type RefCallback = (element: HTMLElement | null) => void | (() => void);

/** Applies one element to several ref callbacks, preserving their cleanups. */
export function mergeRefs(...refs: RefCallback[]): RefCallback {
  return (element) => {
    const cleanups = refs.map((ref) => ref(element)).filter(Boolean);
    if (!cleanups.length) return;
    return () => cleanups.forEach((cleanup) => cleanup!());
  };
}

/**
 * Publishes how far the viewport has travelled through an element as a
 * `--section-progress` custom property (0 → 1) on that element.
 *
 * Descendants read it straight from CSS, so continuous scroll motion costs no
 * React renders. The value is deliberately the same 0→1 measure the 3D camera
 * uses for its booking segment, keeping DOM and scene motion in step.
 */
/**
 * Chase factor shared with the 3D camera (`this.progress += (raw - p) * 0.09`
 * in scene.ts). Using the identical easing here means DOM depth layers and
 * WebGL planes glide with the same physics instead of the DOM tracking raw
 * scroll while the camera lags behind it.
 */
const PROGRESS_CHASE = 0.09;

export function useSectionProgress(enabled: boolean) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      if (!enabled) {
        // 0.5 is the neutral midpoint — every consumer derives its transform
        // from `progress - 0.5`, so this resolves to no displacement at all.
        element.style.setProperty("--section-progress", "0.5");
        return;
      }

      let frame = 0;
      let current = 0;
      let target = 0;
      // Cached, not read live in measure() — mobile browser chrome (the
      // address bar) animates the real viewport height DURING scroll
      // itself, so a live read here made this section's own progress
      // wobble in step with that, independent of actual scroll input.
      // Refreshed only once resize events settle, matching the scene's
      // own resize-debounce.
      let cachedViewportHeight = window.innerHeight;
      let resizeSettleTimeout = 0;

      const measure = () => {
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0) return;
        target = Math.min(
          Math.max((cachedViewportHeight - rect.top) / rect.height, 0),
          1,
        );
      };

      const step = () => {
        // Measured HERE, inside the rAF step — never inside the scroll
        // handler. A native `scroll` event can fire many times per rendered
        // frame during touch momentum scrolling; reading layout on every one
        // of those (getBoundingClientRect forces a synchronous style/layout
        // flush) is real main-thread cost tied to raw input rate rather than
        // display rate. Collapsing it to "at most once per rAF" matches the
        // same read-only-inside-the-loop discipline the 3D scene uses.
        measure();
        frame = 0;
        current += (target - current) * PROGRESS_CHASE;
        if (Math.abs(target - current) < 0.0008) current = target;
        element.style.setProperty("--section-progress", current.toFixed(4));
        if (current !== target) frame = requestAnimationFrame(step);
      };

      const onScroll = () => {
        if (!frame) frame = requestAnimationFrame(step);
      };

      const onResize = () => {
        window.clearTimeout(resizeSettleTimeout);
        resizeSettleTimeout = window.setTimeout(() => {
          cachedViewportHeight = window.innerHeight;
        }, 150);
        onScroll();
      };

      measure();
      current = target;
      element.style.setProperty("--section-progress", target.toFixed(4));
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        window.clearTimeout(resizeSettleTimeout);
        if (frame) cancelAnimationFrame(frame);
      };
    },
    [enabled],
  );
}

/**
 * Freezes an element's scroll-driven transform while keyboard focus is inside
 * it, so nobody types into a field whose panel is drifting beneath them. On
 * focusin the current computed pose is pinned as an inline style (inline wins
 * over the class rule); on focusout the pin is released and the panel eases
 * back to its live pose.
 */
export function useFreezeOnFocus() {
  return useCallback((element: HTMLElement | null) => {
    if (!element) return;

    const freeze = () => {
      element.style.transition = "none";
      element.style.transform = getComputedStyle(element).transform;
    };

    const unfreeze = () => {
      element.style.transition = "transform 0.4s ease";
      element.style.transform = "";
      window.setTimeout(() => {
        // Don't clobber a re-freeze that happened while the release played.
        if (element.style.transform === "") element.style.transition = "";
      }, 450);
    };

    element.addEventListener("focusin", freeze);
    element.addEventListener("focusout", unfreeze);
    return () => {
      element.removeEventListener("focusin", freeze);
      element.removeEventListener("focusout", unfreeze);
    };
  }, []);
}

interface TiltOptions {
  maxTilt?: number;
  lift?: number;
  scale?: number;
  onHover?: () => void;
  onLeave?: () => void;
}

/**
 * Pointer-tracking 3D tilt with a specular highlight. Writes transform and
 * glow position straight to the node — this runs on every mousemove, so it
 * deliberately stays out of React's render path.
 *
 * The ref goes on a stable HITBOX element; the transform is written to a
 * `[data-tilt-target]` descendant (or the hitbox itself when none exists).
 * Splitting them matters: if the element that owns the hover boundary is
 * also the one that tilts and lifts, its own edges sweep under the cursor —
 * and Chrome re-evaluates hover on every scroll frame — producing
 * enter/leave storms and visible pumping near edges. The hitbox never
 * transforms, so the boundary never moves.
 *
 * The transition is set once per hover (on enter), not per mousemove: a
 * short continuous chase toward each new pose. Rewriting the transition on
 * every move meant a re-enter mid-reset hard-snapped the pose.
 */
export function useTilt({
  maxTilt = 9,
  lift = 8,
  scale = 1.03,
  onHover,
  onLeave,
}: TiltOptions = {}) {
  const callbacks = useRef({ onHover, onLeave });
  callbacks.current = { onHover, onLeave };

  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;

      const target =
        element.querySelector<HTMLElement>("[data-tilt-target]") ?? element;

      const pose = (event: MouseEvent) => {
        // Hitbox rect: layout box only, never affected by the tilt itself.
        const rect = element.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;

        target.style.transform = `perspective(900px) rotateX(${(
          -py * maxTilt
        ).toFixed(2)}deg) rotateY(${(px * maxTilt).toFixed(
          2,
        )}deg) translateY(-${lift}px) scale(${scale})`;
        target.style.setProperty("--glow-x", `${(px + 0.5) * 100}%`);
        target.style.setProperty("--glow-y", `${(py + 0.5) * 100}%`);
      };

      const handleEnter = (event: MouseEvent) => {
        target.style.transition =
          "transform 0.22s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.25s ease";
        target.style.boxShadow = "0 22px 44px rgba(0,0,0,0.38)";
        target.style.setProperty("--glow-opacity", "0.16");
        pose(event);
        callbacks.current.onHover?.();
      };

      const handleLeave = () => {
        target.style.transition =
          "transform 0.5s var(--ease-out-expo), box-shadow 0.4s ease";
        target.style.transform =
          "perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)";
        target.style.boxShadow = "none";
        target.style.setProperty("--glow-opacity", "0");
        callbacks.current.onLeave?.();
      };

      element.addEventListener("mouseenter", handleEnter);
      element.addEventListener("mousemove", pose);
      element.addEventListener("mouseleave", handleLeave);

      return () => {
        element.removeEventListener("mouseenter", handleEnter);
        element.removeEventListener("mousemove", pose);
        element.removeEventListener("mouseleave", handleLeave);
      };
    },
    [maxTilt, lift, scale],
  );
}
