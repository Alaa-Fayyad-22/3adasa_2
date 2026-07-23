"use client";

import { useEffect, useRef, useState } from "react";

import { getCategory, tileSlotId, type CategoryId } from "@/lib/portfolio/content";
import { ImageSlot } from "./ImageSlot";
import styles from "./portfolio.module.css";

export interface PhotoDetailProps {
  categoryId: CategoryId;
  index: number;
  /** Which side of the screen has more room, per the clicked photo's on-screen position — see Journey.tsx. */
  side: "left" | "right";
  onDismiss: () => void;
}

/**
 * The click-to-inspect "detail view": a plain DOM overlay layered above the
 * WebGL canvas, entirely outside the 3D scene's shared coordinate space —
 * see the comment on FOCUS_HIDE_RATE in scene.ts for why that separation is
 * what actually fixes the old overlap bug. The corresponding wall plane
 * fades to invisible in the scene (JourneyScene.focusAt/clearFocus) so this
 * is the only copy of the photo ever drawn while it's open.
 *
 * Dismisses on: clicking the photo again, or clicking anywhere outside the
 * photo/text panel (the backdrop). Both call the same `onDismiss` — the
 * caller (Journey.tsx) is what actually clears focus + resumes scrolling.
 */
export function PhotoDetail({ categoryId, index, side, onDismiss }: PhotoDetailProps) {
  const [entered, setEntered] = useState(false);
  const photoRef = useRef<HTMLButtonElement>(null);

  const category = getCategory(categoryId);
  const caption = category.captions[index];

  useEffect(() => {
    // Mount at opacity 0, then flip on the next frame so the CSS transition
    // (see .detailOverlay[data-open]) actually has a starting state to
    // animate from, instead of appearing already-open.
    const frame = requestAnimationFrame(() => setEntered(true));
    photoRef.current?.focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={styles.detailOverlay}
      data-open={entered}
      role="dialog"
      aria-modal="true"
      aria-label={`${category.label} — ${caption}`}
      onClick={onDismiss}
    >
      <div
        className={styles.detailContent}
        data-side={side}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={photoRef}
          type="button"
          className={styles.detailPhoto}
          onClick={onDismiss}
          aria-label="Close detail view"
        >
          <ImageSlot
            slotId={tileSlotId(categoryId, index)}
            alt={`${category.label} — ${caption}`}
            fit="contain"
            eager
            className={styles.fill}
          />
        </button>

        <div className={styles.detailText}>
          <p className={styles.eyebrow}>{category.label}</p>
          <h3 className={styles.detailCaption}>{caption}</h3>
          <p className={styles.detailPlaceholder}>
            Add caption/story text here.
          </p>
        </div>
      </div>
    </div>
  );
}
