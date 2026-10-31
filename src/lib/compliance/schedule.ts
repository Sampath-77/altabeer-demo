// Compliance scheduling helpers — all date math is done in Asia/Dubai (UTC+4, no DST).
export const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4, no DST ever

/** Returns a "YYYY-MM-DD" string representing the Dubai calendar date for a given UTC timestamp. */
export function dubaiDate(utcMs: number): string {
  return new Date(utcMs + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Returns a UTC timestamp for midnight (00:00:00) Dubai time on the given "YYYY-MM-DD" date. */
export function dubaiMidnightUtc(date: string): number {
  return Date.parse(`${date}T00:00:00+04:00`);
}

/**
 * Returns the UTC timestamp of the compliance deadline for a given reporting date.
 * Default: next calendar day at 04:00 Dubai time.
 * Env: COMPLIANCE_DEADLINE_HOUR (0–23, default 4)
 */
export function deadlineForDate(reportingDate: string, nowMs?: number): number {
  const hour = Math.max(0, Math.min(23, Number(process.env.COMPLIANCE_DEADLINE_HOUR ?? 4)));
  // Deadline is reportingDate+1 at <hour>:00 Dubai
  const [y, m, d] = reportingDate.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  // Dubai midnight UTC of next day, plus <hour> hours
  return dubaiMidnightUtc(nextDay.toISOString().slice(0, 10)) + hour * 3600_000;
}

/** True if the compliance deadline for reportingDate has passed. */
export function deadlinePassed(reportingDate: string, nowMs = Date.now()): boolean {
  return nowMs >= deadlineForDate(reportingDate, nowMs);
}

/**
 * Returns the Dubai date (YYYY-MM-DD) that an attendance record belongs to.
 * Overnight shifts: always assigned to the check-in date in Dubai time,
 * never to the check-out date. A single overnight shift generates one obligation.
 */
export function shiftReportingDate(checkInIso: string): string {
  return dubaiDate(Date.parse(checkInIso));
}

/** Returns yesterday's Dubai date string from the given timestamp (default: now). */
export function yesterdayDubai(nowMs = Date.now()): string {
  return dubaiDate(nowMs - 86400_000);
}

/** Generate a readable report reference: REP-YYYYMMDD-XXXX */
export function makeReportRef(reportingDate: string, suffix: string): string {
  return `REP-${reportingDate.replace(/-/g, "")}-${suffix.toUpperCase().slice(0, 6)}`;
}

/** Generate a flag reference: FLG-YYYYMMDD-XXXX */
export function makeFlagRef(reportingDate: string, suffix: string): string {
  return `FLG-${reportingDate.replace(/-/g, "")}-${suffix.toUpperCase().slice(0, 6)}`;
}

