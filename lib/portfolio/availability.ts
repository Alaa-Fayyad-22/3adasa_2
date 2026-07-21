/**
 * Booking availability.
 *
 * Placeholder rules stand in for a real calendar: weekends are closed, plus a
 * few hard-blocked dates. Swap `isUnavailable` for a fetch against whatever
 * actually holds the schedule (CMS, Google Calendar, database) when wiring
 * this up for real.
 */

const BLOCKED_DAYS_OF_MONTH = [5, 6, 19, 20];

export interface CalendarMonth {
  year: number;
  /** 0-indexed, matching `Date.prototype.getMonth`. */
  month: number;
  label: string;
  /** Leading `null`s pad the grid to the correct starting weekday. */
  days: Array<number | null>;
}

/** Bookings open from next month — this month is assumed already committed. */
export function buildCalendar(now: Date = new Date()): CalendarMonth {
  const target = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  const label = target.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: Array<number | null> = [];
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return { year, month, label, days };
}

export function isUnavailable(
  year: number,
  month: number,
  day: number,
): boolean {
  const dayOfWeek = new Date(year, month, day).getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  return BLOCKED_DAYS_OF_MONTH.includes(day);
}

export function formatDate(year: number, month: number, day: number): string {
  return new Date(year, month, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
