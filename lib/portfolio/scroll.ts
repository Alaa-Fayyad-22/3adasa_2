export const SCENE_TRACK_ID = "scene-track";
export const BOOKING_SECTION_ID = "booking";

/** Scroll progress the camera reaches at each named stop on the 3D journey. */
export const WAYPOINTS = {
  portfolio: 0.3,
  about: 0.67,
} as const;

export function scrollToElement(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  window.scrollTo({ top: element.offsetTop, behavior: "smooth" });
}

/**
 * Scrolls to the point on the sticky track where the camera sits at
 * `progress` (0→1), so menu links can land on a moment in the 3D journey.
 */
export function scrollToWaypoint(progress: number): void {
  const track = document.getElementById(SCENE_TRACK_ID);
  if (!track) return;

  const rect = track.getBoundingClientRect();
  const trackTop = window.scrollY + rect.top;
  const scrollable = Math.max(rect.height - window.innerHeight, 0);

  window.scrollTo({
    top: trackTop + scrollable * progress,
    behavior: "smooth",
  });
}
