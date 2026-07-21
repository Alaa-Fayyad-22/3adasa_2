"use client";

import { useEffect, useRef } from "react";

import { getCategory, type CategoryId } from "@/lib/portfolio/content";
import { JourneyScene } from "@/lib/portfolio/scene";
import { BOOKING_SECTION_ID, SCENE_TRACK_ID } from "@/lib/portfolio/scroll";
import { CategoryFilter } from "./CategoryFilter";
import styles from "./portfolio.module.css";

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

  // Latest callbacks, read from inside the render loop without re-creating it.
  const handlers = useRef({ onHoverChange, onOpenTile, onReady });
  handlers.current = { onHoverChange, onOpenTile, onReady };

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    if (!canvas || !track) return;

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
      }),
      onHoverChange: (index, caption) =>
        handlers.current.onHoverChange(index, caption),
      onReady: () => handlers.current.onReady(),
    });

    sceneRef.current = scene;
    scene.start();

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // Rebuilt only if the parallax setting changes; category and callbacks are
    // pushed in through refs and dedicated effects instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallaxIntensity]);

  useEffect(() => {
    sceneRef.current?.syncCategory(activeCategory);
  }, [activeCategory]);

  // Clicking anywhere over a hovered plane opens it — the canvas itself is
  // pointer-transparent, so the listener lives on the window.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const scene = sceneRef.current;
      if (!scene) return;

      // Don't hijack clicks meant for the overlay controls sitting in front.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, label")) return;

      const hit = scene.getClickTarget();
      if (!hit) return;

      scene.playRevealTransition(hit.texture, () =>
        handlers.current.onOpenTile(hit.index),
      );
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleSelectCategory = (id: CategoryId) => {
    const scene = sceneRef.current;
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
            <p className={styles.eyebrow}>About</p>
            <h2 className={styles.journeyAboutHeading}>
              A practice built on waiting for the frame that doesn&rsquo;t need
              explaining.
            </h2>
            <p className={styles.bodyCopy}>
              Jad Daou works at the edge of light — where coastline meets fog,
              and portraiture becomes landscape.
            </p>
            <p className={styles.bodyCopy}>
              Prints and limited-edition works are available by request. For
              sessions, see below.
            </p>
          </div>
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
    </>
  );
}
