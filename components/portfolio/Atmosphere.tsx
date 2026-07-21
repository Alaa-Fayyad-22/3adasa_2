"use client";

import { useEffect, useRef } from "react";

import styles from "./portfolio.module.css";

/**
 * Full-screen wordmark shown on first paint, then dissolved. `visible` drives
 * the fade; the parent unmounts this once the transition has finished.
 */
export function Loader({
  visible,
  textIn,
}: {
  visible: boolean;
  textIn: boolean;
}) {
  return (
    <div
      className={styles.loader}
      data-visible={visible}
      aria-hidden="true"
      role="presentation"
    >
      <div className={styles.loaderMark} data-in={textIn}>
        JAD&nbsp;DAOU
      </div>
    </div>
  );
}

/** Animated film grain laid over everything, blended to taste. */
export function Grain({ intensity }: { intensity: number }) {
  return (
    <div
      className={styles.grain}
      style={{ opacity: intensity }}
      aria-hidden="true"
    />
  );
}

/**
 * Replacement pointer: a small dot that swells into a "VIEW" ring over
 * anything clickable. Positioned imperatively to avoid a render per mousemove.
 */
export function Cursor({ expanded }: { expanded: boolean }) {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const dot = dotRef.current;
      if (!dot) return;
      dot.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) translate(-50%, -50%)`;
    };

    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div
      ref={dotRef}
      className={styles.cursor}
      data-expanded={expanded}
      aria-hidden="true"
    >
      <span className={styles.cursorLabel}>View</span>
    </div>
  );
}
