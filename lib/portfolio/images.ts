export const HERO_SLOT_ID = "hero-image";
/** The smaller print floating nearer the camera in the hero scene. */
export const HERO_NEAR_SLOT_ID = "hero-image-near";
export const ABOUT_SLOT_ID = "about-portrait";

/**
 * Locally-bundled sample photography (public/assets/samples/), downloaded once
 * from picsum.photos seeded URLs so the site works offline and textures load
 * instantly. Dimensions are recorded so the 3D planes can match each photo's
 * aspect ratio instead of cropping or stretching.
 *
 * To ship real photography: drop files in public/assets/samples (or anywhere
 * under /public), add them here with their pixel dimensions, and point the
 * relevant slot in SLOT_ASSIGNMENTS at them.
 */
interface Photo {
  src: string;
  width: number;
  height: number;
}

const sample = (name: string, width: number, height: number): Photo => ({
  src: `/assets/samples/${name}`,
  width,
  height,
});

const PHOTOS = {
  "scenery-01": sample("scenery-01.jpg", 1600, 1000),
  "scenery-02": sample("scenery-02.jpg", 1600, 1000),
  "scenery-03": sample("scenery-03.jpg", 1600, 1000),
  "scenery-04": sample("scenery-04.jpg", 1600, 1000),
  "scenery-05": sample("scenery-05.jpg", 1600, 1000),
  "portrait-01": sample("portrait-01.jpg", 1000, 1400),
  "portrait-02": sample("portrait-02.jpg", 1000, 1400),
  "portrait-03": sample("portrait-03.jpg", 1000, 1400),
  "portrait-04": sample("portrait-04.jpg", 1000, 1400),
  "portrait-05": sample("portrait-05.jpg", 1000, 1400),
  "editorial-01": sample("editorial-01.jpg", 1600, 1000),
  "editorial-02": sample("editorial-02.jpg", 1000, 1400),
  "editorial-03": sample("editorial-03.jpg", 1600, 1000),
  "editorial-04": sample("editorial-04.jpg", 1000, 1400),
  "editorial-05": sample("editorial-05.jpg", 1600, 1000),
  "about-portrait": sample("about-portrait.jpg", 1000, 1400),
} satisfies Record<string, Photo>;

type PhotoName = keyof typeof PHOTOS;

/**
 * Slot → photograph. Orientation policy per tab:
 *   portraits — portrait-oriented only
 *   landscape — landscape-oriented only
 *   weddings / fashion — a deliberate mix of both
 * The mixed tabs' order matches their span pattern in content.ts
 * (L, P, P, L, L, P), so tall photos land on tall tiles.
 */
const SLOT_ASSIGNMENTS: Record<string, PhotoName> = {
  [HERO_SLOT_ID]: "scenery-01",
  [HERO_NEAR_SLOT_ID]: "scenery-03",
  [ABOUT_SLOT_ID]: "about-portrait",

  "portfolio-portraits-0": "portrait-01",
  "portfolio-portraits-1": "portrait-02",
  "portfolio-portraits-2": "portrait-03",
  "portfolio-portraits-3": "portrait-04",
  "portfolio-portraits-4": "portrait-05",
  "portfolio-portraits-5": "editorial-02",

  "portfolio-landscape-0": "scenery-01",
  "portfolio-landscape-1": "scenery-02",
  "portfolio-landscape-2": "scenery-03",
  "portfolio-landscape-3": "scenery-04",
  "portfolio-landscape-4": "scenery-05",
  "portfolio-landscape-5": "editorial-03",

  "portfolio-weddings-0": "scenery-02",
  "portfolio-weddings-1": "portrait-02",
  "portfolio-weddings-2": "portrait-04",
  "portfolio-weddings-3": "scenery-04",
  "portfolio-weddings-4": "editorial-03",
  "portfolio-weddings-5": "editorial-04",

  "portfolio-fashion-0": "editorial-01",
  "portfolio-fashion-1": "editorial-02",
  "portfolio-fashion-2": "editorial-04",
  "portfolio-fashion-3": "editorial-05",
  "portfolio-fashion-4": "scenery-05",
  "portfolio-fashion-5": "portrait-03",
};

export function imageSource(slotId: string): string | undefined {
  const name = SLOT_ASSIGNMENTS[slotId];
  return name ? PHOTOS[name].src : undefined;
}

/** width / height of the photograph assigned to a slot. */
export function imageAspect(slotId: string): number | undefined {
  const name = SLOT_ASSIGNMENTS[slotId];
  if (!name) return undefined;
  const photo = PHOTOS[name];
  return photo.width / photo.height;
}
