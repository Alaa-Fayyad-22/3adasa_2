"use client";

import { useEffect, useRef } from "react";

import { getCategory, tileSlotId, type CategoryId } from "@/lib/portfolio/content";
import { ImageSlot } from "./ImageSlot";
import styles from "./portfolio.module.css";

interface LightboxProps {
  categoryId: CategoryId;
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function Lightbox({
  categoryId,
  index,
  onClose,
  onNext,
  onPrev,
}: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const category = getCategory(categoryId);
  const caption = category.captions[index];

  useEffect(() => {
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onNext();
      if (event.key === "ArrowLeft") onPrev();
    };

    window.addEventListener("keydown", handleKeyDown);

    // Freeze the page behind the overlay so scrolling doesn't move the 3D camera.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onNext, onPrev]);

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={`${category.label} — ${caption}`}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className={styles.lightboxClose}
      >
        Close
      </button>

      <button
        type="button"
        onClick={onPrev}
        className={styles.lightboxPrev}
        aria-label="Previous photograph"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        className={styles.lightboxNext}
        aria-label="Next photograph"
      >
        ›
      </button>

      <div className={styles.lightboxFrame}>
        <ImageSlot
          slotId={tileSlotId(categoryId, index)}
          alt={`${category.label} — ${caption}`}
          fit="contain"
          eager
          className={styles.fill}
        />
      </div>

      <p className={styles.lightboxCaption}>{caption}</p>
    </div>
  );
}
