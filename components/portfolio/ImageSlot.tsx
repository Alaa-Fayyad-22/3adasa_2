import { imageSource } from "@/lib/portfolio/images";
import styles from "./portfolio.module.css";

interface ImageSlotProps {
  /** Key into `IMAGE_SOURCES`; also identifies the matching 3D wall plane. */
  slotId: string;
  /** Describes the photograph, and doubles as the placeholder's label. */
  alt: string;
  fit?: "cover" | "contain";
  className?: string;
  /** Skip lazy-loading for above-the-fold slots. */
  eager?: boolean;
}

/**
 * One photograph. Falls back to a labelled placeholder while no source is
 * configured, so the layout holds its shape before the imagery lands.
 */
export function ImageSlot({
  slotId,
  alt,
  fit = "cover",
  className,
  eager = false,
}: ImageSlotProps) {
  const src = imageSource(slotId);
  const classes = [styles.slot, className].filter(Boolean).join(" ");

  if (!src) {
    return (
      <div className={classes} role="img" aria-label={alt}>
        <span className={styles.slotPlaceholder} aria-hidden="true">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <div className={classes}>
      {/* Plain <img>: sources are author-supplied and may be remote, and the
          3D scene loads the same URLs directly rather than an optimised variant. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={fit === "contain" ? styles.slotImgContain : styles.slotImg}
      />
    </div>
  );
}
