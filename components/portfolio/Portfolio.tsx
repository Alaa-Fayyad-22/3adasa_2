"use client";

import { useCallback, useEffect, useState } from "react";

import {
  TILES_PER_CATEGORY,
  type CategoryId,
} from "@/lib/portfolio/content";
import { useHasFinePointer, useMotionPreference } from "@/lib/portfolio/hooks";
import { detectWebglSupport } from "@/lib/portfolio/scene";
import { scrollToElement, scrollToWaypoint, WAYPOINTS } from "@/lib/portfolio/scroll";
import { Booking } from "./Booking";
import { Cursor, Grain, Loader } from "./Atmosphere";
import { Journey } from "./Journey";
import { Lightbox } from "./Lightbox";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader, type NavTarget } from "./SiteHeader";
import { StaticShowcase } from "./StaticShowcase";
import styles from "./portfolio.module.css";

export interface PortfolioSettings {
  /** Film grain opacity, 0–0.15. */
  grainIntensity?: number;
  /** Pointer/scroll parallax strength, 0–0.6. */
  parallaxIntensity?: number;
  /** Replace the system pointer with the custom dot on fine-pointer devices. */
  customCursor?: boolean;
}

type RenderMode = "detecting" | "immersive" | "flat";

interface LightboxState {
  categoryId: CategoryId;
  index: number;
}

export function Portfolio({
  grainIntensity = 0.05,
  parallaxIntensity = 0.3,
  customCursor = true,
}: PortfolioSettings) {
  const [mode, setMode] = useState<RenderMode>("detecting");
  const [loaderVisible, setLoaderVisible] = useState(true);
  const [loaderMounted, setLoaderMounted] = useState(true);
  const [loaderTextIn, setLoaderTextIn] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("portraits");
  const [hoverCaption, setHoverCaption] = useState("");
  const [cursorExpanded, setCursorExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const hasFinePointer = useHasFinePointer();
  const motionPreference = useMotionPreference();
  const reducedMotion = motionPreference === "reduced";

  // Intro sequence: fade the wordmark in, hold, dissolve, then unmount.
  useEffect(() => {
    const timers = [
      setTimeout(() => setLoaderTextIn(true), 150),
      setTimeout(() => setLoaderVisible(false), 2000),
      setTimeout(() => setLoaderMounted(false), 3100),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Choose the 3D journey or the flat layout once we can inspect the browser.
  // `null` means the preference isn't resolved yet — stay in "detecting" so
  // neither path mounts and then immediately swaps.
  useEffect(() => {
    if (motionPreference === null) return;
    if (motionPreference === "reduced") {
      setMode("flat");
      return;
    }
    setMode(detectWebglSupport() ? "immersive" : "flat");
  }, [motionPreference]);

  const handleHoverChange = useCallback((index: number, caption: string) => {
    setCursorExpanded(index >= 0);
    setHoverCaption(caption);
  }, []);

  const openTile = useCallback(
    (index: number) => setLightbox({ categoryId: activeCategory, index }),
    [activeCategory],
  );

  const closeLightbox = useCallback(() => setLightbox(null), []);

  const nextImage = useCallback(() => {
    setLightbox((current) =>
      current
        ? { ...current, index: (current.index + 1) % TILES_PER_CATEGORY }
        : null,
    );
  }, []);

  const prevImage = useCallback(() => {
    setLightbox((current) =>
      current
        ? {
            ...current,
            index:
              (current.index + TILES_PER_CATEGORY - 1) % TILES_PER_CATEGORY,
          }
        : null,
    );
  }, []);

  const handleNavigate = useCallback(
    (target: NavTarget) => {
      setMenuOpen(false);

      if (target === "booking" || target === "contact") {
        scrollToElement(target);
        return;
      }
      // In the 3D journey these sections are moments on the camera path
      // rather than elements of their own.
      if (mode === "immersive") {
        scrollToWaypoint(WAYPOINTS[target]);
        return;
      }
      scrollToElement(target);
    },
    [mode],
  );

  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);

  const showCursor = customCursor && hasFinePointer && !reducedMotion;

  return (
    <div id="top" className={styles.root} data-hide-cursor={showCursor}>
      {loaderMounted && <Loader visible={loaderVisible} textIn={loaderTextIn} />}

      <Grain intensity={grainIntensity} />

      {showCursor && <Cursor expanded={cursorExpanded} />}

      <SiteHeader
        menuOpen={menuOpen}
        onToggleMenu={toggleMenu}
        onNavigate={handleNavigate}
      />

      {mode === "immersive" && (
        <Journey
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          hoverCaption={hoverCaption}
          onHoverChange={handleHoverChange}
          onOpenTile={openTile}
          parallaxIntensity={parallaxIntensity}
          onReady={() => undefined}
        />
      )}

      {mode === "flat" && (
        <StaticShowcase
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onOpenTile={openTile}
          parallaxIntensity={reducedMotion ? 0 : parallaxIntensity}
          heroRevealed={!loaderVisible}
        />
      )}

      <Booking
        onCursorLabel={setCursorExpanded}
        scrollMotion={motionPreference === "full"}
      />

      <SiteFooter />

      {lightbox && (
        <Lightbox
          categoryId={lightbox.categoryId}
          index={lightbox.index}
          onClose={closeLightbox}
          onNext={nextImage}
          onPrev={prevImage}
        />
      )}
    </div>
  );
}
