/**
 * Returns a [start, end] tuple covering the full calendar day of `date`.
 *
 * Replaces the boilerplate:
 * ```
 * const startOfDay = new Date(date); startOfDay.setHours(0,0,0,0);
 * const endOfDay   = new Date(date); endOfDay.setHours(23,59,59,999);
 * ```
 */
export function getDayRange(date: Date): [start: Date, end: Date] {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return [start, end];
}

/**
 * Returns a Date that is `days` calendar days before `referenceDate` (defaults to now).
 */
export function daysAgo(days: number, referenceDate: Date = new Date()): Date {
  return new Date(referenceDate.getTime() - days * 24 * 60 * 60 * 1000);
}
