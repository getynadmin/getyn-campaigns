/**
 * Phase 5.5 M8 — pure-function coverage for usage measurement.
 *
 * The DB-dependent counters are exercised end-to-end in the manual
 * dev workflow; this file locks down the calendar-month boundary
 * util that drives every period-bound query.
 */
import { describe, expect, it } from 'vitest';

import { startOfCalendarMonthUTC } from './measure-usage';

describe('startOfCalendarMonthUTC', () => {
  it('snaps to the 1st of the current UTC month at 00:00', () => {
    const now = new Date('2026-05-15T18:30:45.123Z');
    const start = startOfCalendarMonthUTC(now);
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('treats the 1st at 00:00 as itself', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    expect(startOfCalendarMonthUTC(now).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('uses UTC even when the runtime tz would land in a different month', () => {
    // 2026-01-01T00:30Z is still Dec 31 in PST — the function must
    // anchor on UTC, not local.
    const now = new Date('2026-01-01T00:30:00.000Z');
    expect(startOfCalendarMonthUTC(now).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('handles year boundaries', () => {
    const now = new Date('2026-12-31T23:59:59.999Z');
    expect(startOfCalendarMonthUTC(now).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });
});
