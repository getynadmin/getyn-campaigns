import { describe, expect, it } from 'vitest';

import { computeSuspensionDecision } from '@getyn/db';

/**
 * Pure tests for the suspension decision function. Side-effecting
 * `checkAndApplySuspension` needs the DB; we test only the math here.
 */

const base = {
  complaintRateThreshold: 0.003,
  bounceRateThreshold: 0.05,
};

describe('computeSuspensionDecision — sample size floor', () => {
  it('does not suspend below the minimum sample size, even at high rates', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.5,
      cachedBounceRate30d: 0.5,
      cachedSendCount30d: 50,
    });
    expect(r.shouldSuspend).toBe(false);
    expect(r.reason).toBeNull();
  });

  it('respects a custom minSampleSize', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.5,
      cachedBounceRate30d: 0,
      cachedSendCount30d: 100,
      minSampleSize: 50,
    });
    // 100 >= 50, so the rate check fires; complaint rate exceeds threshold.
    expect(r.shouldSuspend).toBe(true);
  });
});

describe('computeSuspensionDecision — under thresholds', () => {
  it('does not suspend when both rates are below threshold', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.001,
      cachedBounceRate30d: 0.02,
      cachedSendCount30d: 10000,
    });
    expect(r.shouldSuspend).toBe(false);
  });

  it('returns the rates snapshot regardless of decision', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.001,
      cachedBounceRate30d: 0.02,
      cachedSendCount30d: 10000,
    });
    expect(r.rates).toEqual({
      complaintRate30d: 0.001,
      bounceRate30d: 0.02,
      sendCount30d: 10000,
    });
  });
});

describe('computeSuspensionDecision — over thresholds', () => {
  it('suspends when complaint rate exceeds threshold', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.005,
      cachedBounceRate30d: 0.01,
      cachedSendCount30d: 1000,
    });
    expect(r.shouldSuspend).toBe(true);
    expect(r.reason).toContain('Complaint rate');
  });

  it('suspends when bounce rate exceeds threshold', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.001,
      cachedBounceRate30d: 0.06,
      cachedSendCount30d: 1000,
    });
    expect(r.shouldSuspend).toBe(true);
    expect(r.reason).toContain('Bounce rate');
  });

  it('reports complaint rate first when both are over', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.005,
      cachedBounceRate30d: 0.06,
      cachedSendCount30d: 1000,
    });
    expect(r.shouldSuspend).toBe(true);
    expect(r.reason).toContain('Complaint rate');
  });

  it('does not suspend exactly at threshold', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.003, // == threshold
      cachedBounceRate30d: 0.05, // == threshold
      cachedSendCount30d: 1000,
    });
    expect(r.shouldSuspend).toBe(false);
  });

  it('formats reason with both percentages', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.0125,
      cachedBounceRate30d: 0.01,
      cachedSendCount30d: 1000,
    });
    expect(r.reason).toContain('1.25%');
    expect(r.reason).toContain('0.30%');
  });

  it('includes send count in reason', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0.005,
      cachedBounceRate30d: 0.01,
      cachedSendCount30d: 12345,
    });
    expect(r.reason).toContain('12345');
  });

  it('handles a zero-send-count gracefully', () => {
    const r = computeSuspensionDecision({
      ...base,
      cachedComplaintRate30d: 0,
      cachedBounceRate30d: 0,
      cachedSendCount30d: 0,
    });
    expect(r.shouldSuspend).toBe(false);
  });
});
