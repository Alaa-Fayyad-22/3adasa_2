import { CATEGORIES, TILES_PER_CATEGORY, tileSlotId } from "./content";

export const HERO_SLOT_ID = "hero-image";
export const ABOUT_SLOT_ID = "about-portrait";

/**
 * Locally-bundled placeholder photograph (public/photos/sample.jpg). Every
 * slot points at it so layout, cover-cropping, and the 3D plane textures can
 * be evaluated without third-party services or a network connection.
 */
const SAMPLE_PHOTO = "/photos/sample.jpg";

/**
 * Photograph sources, keyed by slot id.
 *
 * Slot ids:
 *   `portfolio-<categoryId>-<0..5>`  — the six tiles of each category
 *   `hero-image`                     — full-bleed hero
 *   `about-portrait`                 — portrait beside the About copy
 *
 * To ship real photography, overwrite individual entries after the loop (or
 * replace the whole map) with paths under /public or remote URLs — e.g.
 *   IMAGE_SOURCES["portfolio-portraits-0"] = "/photos/portraits-01.jpg";
 * Remote hosts need `images.remotePatterns` in next.config.mjs if ImageSlot
 * is ever switched to next/image.
 */
export const IMAGE_SOURCES: Record<string, string> = (() => {
  const sources: Record<string, string> = {
    [HERO_SLOT_ID]: SAMPLE_PHOTO,
    [ABOUT_SLOT_ID]: SAMPLE_PHOTO,
  };
  for (const category of CATEGORIES) {
    for (let i = 0; i < TILES_PER_CATEGORY; i++) {
      sources[tileSlotId(category.id, i)] = SAMPLE_PHOTO;
    }
  }
  return sources;
})();

export function imageSource(slotId: string): string | undefined {
  return IMAGE_SOURCES[slotId];
}
