"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getCategory, type CategoryId } from "@/lib/portfolio/content";
import { JourneyScene } from "@/lib/portfolio/scene";
import {
  BOOKING_SECTION_ID,
  disposeLenis,
  getLenis,
  initLenis,
  SCENE_TRACK_ID,
} from "@/lib/portfolio/scroll";
import { CategoryFilter } from "./CategoryFilter";
import { PhotoDetail } from "./PhotoDetail";
import styles from "./portfolio.module.css";

interface FocusedTile {
  index: number;
  side: "left" | "right";
}

interface JourneyProps {
  activeCategory: CategoryId;
  onCategoryChange: (id: CategoryId) => void;
  hoverCaption: string;
  onHoverChange: (index: number, caption: string) => void;
  onOpenTile: (index: number) => void;
  parallaxIntensity: number;
  onReady: () => void;
}

/**
 * The scroll-driven 3D gallery: a tall sticky track whose scroll position
 * flies the camera past the hero, along a wall of six photographs, and into
 * the About plane. HTML overlays ride on top and are cross-faded by the
 * render loop.
 */
export function Journey({
  activeCategory,
  onCategoryChange,
  hoverCaption,
  onHoverChange,
  onOpenTile,
  parallaxIntensity,
  onReady,
}: JourneyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<JourneyScene | null>(null);

  const heroRef = useRef<HTMLDivElement>(null);
  const scrollCueRef = useRef<HTMLDivElement>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const portfolioCaptionRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<HTMLDivElement>(null);

  // Latest callbacks, read from inside the render loop without re-creating it.
  const handlers = useRef({ onHoverChange, onReady });
  handlers.current = { onHoverChange, onReady };

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;

    // Lenis is created here — the immersive journey mounting IS the signal
    // that full motion is wanted (Portfolio only renders this component
    // when motion isn't reduced and WebGL is available), so there's no
    // separate reduced-motion check to duplicate. Created before
    // scene.start() so the very first animate() frame already has it.
    initLenis();

    const scene = new JourneyScene({
      canvas,
      track,
      // Booking is a sibling of this subtree, so it's resolved by id rather
      // than threaded through as a ref.
      getBookingSection: () => document.getElementById(BOOKING_SECTION_ID),
      parallaxIntensity,
      initialCategory: activeCategory,
      getOverlays: () => ({
        hero: heroRef.current,
        scrollCue: scrollCueRef.current,
        portfolio: portfolioRef.current,
        portfolioCaption: portfolioCaptionRef.current,
        about: aboutRef.current,
        handoff: handoffRef.current,
      }),
      onHoverChange: (index, caption) =>
        handlers.current.onHoverChange(index, caption),
      onReady: () => handlers.current.onReady(),
      tickLenis: () => getLenis()?.raf(performance.now()),
    });

    sceneRef.current = scene;
    scene.start();

    return () => {
      scene.dispose();
      sceneRef.current = null;
      disposeLenis();
    };
    // Rebuilt only if the parallax setting changes; category and callbacks are
    // pushed in through refs and dedicated effects instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallaxIntensity]);

  // The click-to-inspect "detail view" — see PhotoDetail.tsx. `null` means
  // closed. Kept in a ref alongside the state so the stable window click
  // listener below (added once, deps []) can read the latest value without
  // needing to be re-subscribed every open/close.
  const [focusedTile, setFocusedTile] = useState<FocusedTile | null>(null);
  const focusedTileRef = useRef(focusedTile);
  focusedTileRef.current = focusedTile;

  const dismissFocus = useCallback(() => {
    sceneRef.current?.clearFocus();
    setFocusedTile(null);
  }, []);

  useEffect(() => {
    sceneRef.current?.syncCategory(activeCategory);
    // A focused photo belongs to the category it was opened from; switching
    // tabs (via the filter, not this effect) already drops scene-side focus
    // in transitionCategory/syncCategory, so the DOM detail view must follow.
    setFocusedTile(null);
  }, [activeCategory]);

  // Clicking (or tapping) ANY visible corridor photo — whether it's the
  // fully-arrived nearest one or one still approaching/receding at another
  // depth — opens the DOM detail view (PhotoDetail.tsx) for it; see
  // JourneyScene.focusAt, which raycasts fresh from the click point so it
  // finds whichever plane is actually under the pointer. The canvas itself
  // is pointer-transparent, so the listener lives on the window. `click`
  // fires for taps too, so this works the same way on touch.
  //
  // While the detail view is open this listener stands down entirely — its
  // own backdrop/photo click handlers own dismissal (see PhotoDetail.tsx),
  // so a click landing on the backdrop doesn't ALSO get raycast here and
  // reopen a different (now-dimmed) background photo instead of closing.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const scene = sceneRef.current;
      if (!scene || focusedTileRef.current) return;

      // Don't hijack clicks meant for the overlay controls sitting in front.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, label")) return;

      const hit = scene.focusAt(event.clientX, event.clientY);
      if (!hit) return;

      // Side is derived from WHERE ON SCREEN the click landed, not the
      // mesh's own projected position — every corridor photo is pinned to
      // the camera's live X and so always projects near screen-centre (see
      // the "no lateral field" comment in scene.ts), which would make a
      // mesh-position-based side pick nearly always the same. The click
      // point still varies meaningfully across a large on-screen photo, and
      // is exactly "its current on-screen position" from the photo's own
      // point of view (where the viewer's attention/hand actually is).
      const side = event.clientX < window.innerWidth / 2 ? "right" : "left";
      setFocusedTile({ index: hit.index, side });
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  // Freeze scrolling for the duration of the detail view — same technique
  // Lightbox.tsx uses — so the camera can't keep dollying through the
  // corridor while a photo is being inspected. Both Lenis (which otherwise
  // keeps driving scroll from wheel/touch input) and native scroll are
  // paused; releasing both here is what makes "scrolling resumes completely
  // normally" on dismiss true rather than aspirational.
  useEffect(() => {
    if (!focusedTile) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    getLenis()?.stop();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissFocus();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      getLenis()?.start();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusedTile, dismissFocus]);

  const handleSelectCategory = (id: CategoryId) => {
    const scene = sceneRef.current;
    dismissFocus();
    if (!scene) {
      onCategoryChange(id);
      return;
    }
    // Swap React state at the midpoint of the wall's swing-out/swing-in.
    scene.transitionCategory(id, () => onCategoryChange(id));
  };

  const category = getCategory(activeCategory);

  return (
    <>
      <canvas ref={canvasRef} className={styles.sceneCanvas} aria-hidden="true" />

      <div id={SCENE_TRACK_ID} ref={trackRef} className={styles.sceneTrack}>
        <div className={styles.sceneStage}>
          <div ref={heroRef} className={styles.heroOverlay}>
            <p className={styles.eyebrow}>
              Photography — Portraits · Landscape · Weddings · Fashion
            </p>
            <h1 className={styles.heroTitle}>Jad&nbsp;Daou</h1>
            <p className={styles.heroTagline}>
              Coastal light. Quiet portraits. Editorial stillness.
            </p>
          </div>

          <div ref={scrollCueRef} className={styles.scrollCue} aria-hidden="true">
            <span className={styles.scrollCueLine} />
            <span className={styles.scrollCueLabel}>Scroll</span>
          </div>

          <div ref={portfolioRef} className={styles.journeyPortfolio}>
            <div>
              <p className={styles.eyebrow}>Selected Work</p>
              <h2 className={styles.journeyHeading}>The&nbsp;Portfolio</h2>
            </div>
            <CategoryFilter
              active={activeCategory}
              onSelect={handleSelectCategory}
            />
          </div>

          <div ref={portfolioCaptionRef} className={styles.journeyCaption}>
            <span>{hoverCaption}</span>
          </div>

          <div ref={aboutRef} className={styles.journeyAbout}>
            <div className={styles.journeyAboutInner}>
              <p className={styles.eyebrow}>About</p>
              <h2 className={styles.journeyAboutHeading}>
                A practice built on waiting for the frame that doesn&rsquo;t
                need explaining.
              </h2>
              <p className={styles.bodyCopy}>
                Jad Daou works at the edge of light — where coastline meets
                fog, and portraiture becomes landscape.
              </p>
              <p className={styles.bodyCopy}>
                Prints and limited-edition works are available by request.
                For sessions, see below.
              </p>
            </div>
          </div>

          {/* Bridges the portfolio iris mechanic and About's own
              depth-dive/tile-scatter entrance — see handoffOpacityAt in
              scene.ts. A brief dark hold, not a rebuild of either system. */}
          <div ref={handoffRef} className={styles.journeyHandoff} aria-hidden="true" />
        </div>
      </div>

      {/* The gallery only exists as WebGL geometry, so mirror it as text for
          assistive tech and crawlers. */}
      <ul className={styles.visuallyHidden}>
        {category.captions.map((caption, index) => (
          <li key={caption}>
            <button type="button" onClick={() => onOpenTile(index)}>
              {category.label} — {caption}
            </button>
          </li>
        ))}
      </ul>

      {focusedTile && (
        <PhotoDetail
          categoryId={activeCategory}
          index={focusedTile.index}
          side={focusedTile.side}
          onDismiss={dismissFocus}
        />
      )}
    </>
  );
}
