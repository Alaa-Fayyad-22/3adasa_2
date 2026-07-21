export type CategoryId = "portraits" | "landscape" | "weddings" | "fashion";

export interface Category {
  id: CategoryId;
  label: string;
  /** Six captions per category — the grid and the 3D wall both expect exactly six. */
  captions: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: "portraits",
    label: "Portraits",
    captions: [
      "Study in Light",
      "Quiet Portrait I",
      "The Long Look",
      "Overcast Portrait",
      "Half Light",
      "Portrait, No. VI",
    ],
  },
  {
    id: "landscape",
    label: "Landscape",
    captions: [
      "Low Tide, Big Sur",
      "Fog Line",
      "Coastal Ridge",
      "Morning Swell",
      "Salt Air",
      "Horizon, Dusk",
    ],
  },
  {
    id: "weddings",
    label: "Weddings",
    captions: [
      "First Look",
      "Vow Exchange",
      "Golden Hour Recessional",
      "Reception, Late",
      "Hand in Hand",
      "The Toast",
    ],
  },
  {
    id: "fashion",
    label: "Fashion",
    captions: [
      "Editorial I",
      "Structure & Silk",
      "Studio, No. IV",
      "Movement Study",
      "Shadow Play",
      "Editorial VI",
    ],
  },
];

export const TILES_PER_CATEGORY = 6;

/** [columnSpan, rowSpan] for each of the six tiles in the 2D masonry grid. */
export const SPAN_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [6, 2],
  [3, 2],
  [3, 2],
  [2, 1],
  [2, 1],
  [2, 1],
];

export function getCategory(id: CategoryId): Category {
  const found = CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown category: ${id}`);
  return found;
}

/** Stable identity for one photograph, shared by the grid, the 3D wall, and the lightbox. */
export function tileSlotId(categoryId: CategoryId, index: number): string {
  return `portfolio-${categoryId}-${index}`;
}

export interface Package {
  id: string;
  name: string;
  duration: string;
  price: string;
  includes: string[];
  badge?: boolean;
}

export const PACKAGES: Package[] = [
  {
    id: "session",
    name: "Portrait Session",
    duration: "1 hour · studio or on-location",
    price: "$450",
    includes: [
      "One location or studio setup",
      "1 outfit change",
      "30 edited images",
      "Private online gallery",
    ],
  },
  {
    id: "location",
    name: "Location Shoot",
    duration: "2.5 hours · up to 2 locations",
    price: "$850",
    includes: [
      "Engagement, lifestyle, or branding",
      "2 outfit changes",
      "60 edited images",
      "Print release included",
    ],
    badge: true,
  },
  {
    id: "fullday",
    name: "Full Day",
    duration: "8 hours · unlimited locations",
    price: "$2,400",
    includes: [
      "Full wedding or editorial coverage",
      "200+ edited images",
      "Second shooter available",
      "Priority turnaround",
    ],
  },
];

export const DEFAULT_PACKAGE_ID = "location";

export const CONTACT = {
  email: "hello@jaddaou.com",
  phone: "+1 (800) 555 0123",
  phoneHref: "tel:+18005550123",
  instagram: "#",
  journal: "#",
};
