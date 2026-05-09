/**
 * Phase 4 M10 / M12 — service-window math.
 *
 * The composer state + UI badges depend on this; bugs here mean
 * tenants try to send free-form text outside the 24h window and get
 * Meta-rejected. Boundary-heavy test coverage.
 */
import {
  bumpServiceWindowOnInbound,
  bumpServiceWindowOnOutbound,
  computeServiceWindow,
} from './service-window';
import { describe, expect, it } from 'vitest';

const NOW = new Date('2026-05-09T12:00:00Z');

describe('computeServiceWindow', () => {
  it('returns "never" when expiresAt is null', () => {
    const r = computeServiceWindow(null, NOW);
    expect(r).toEqual({ open: false, remainingMs: 0, label: '', tone: 'never' });
  });

  it('treats undefined the same as null', () => {
    expect(computeServiceWindow(undefined, NOW).tone).toBe('never');
  });

  it('returns "closed" when expiresAt is in the past', () => {
    const past = new Date(NOW.getTime() - 60_000);
    const r = computeServiceWindow(past, NOW);
    expect(r.open).toBe(false);
    expect(r.tone).toBe('closed');
    expect(r.remainingMs).toBe(0);
  });

  it('returns "closed" exactly at expiry boundary', () => {
    // ms-equal counts as already closed (remainingMs=0).
    const r = computeServiceWindow(NOW, NOW);
    expect(r.tone).toBe('closed');
  });

  it('returns "closing-soon" when <2h remain', () => {
    const at = new Date(NOW.getTime() + 90 * 60_000); // 90 min
    const r = computeServiceWindow(at, NOW);
    expect(r.open).toBe(true);
    expect(r.tone).toBe('closing-soon');
    expect(r.label).toMatch(/^Closing soon \(\d+m\)$/);
  });

  it('returns "closing-soon" exactly at 2h boundary', () => {
    const at = new Date(NOW.getTime() + 2 * 60 * 60_000);
    const r = computeServiceWindow(at, NOW);
    expect(r.tone).toBe('closing-soon');
  });

  it('returns "open" when >2h remain', () => {
    const at = new Date(NOW.getTime() + 8 * 60 * 60_000); // 8h
    const r = computeServiceWindow(at, NOW);
    expect(r.open).toBe(true);
    expect(r.tone).toBe('open');
    expect(r.label).toBe('Window open (8h)');
  });

  it('renders 23h on freshly-opened window', () => {
    const at = new Date(NOW.getTime() + 23 * 60 * 60_000 + 30 * 60_000);
    const r = computeServiceWindow(at, NOW);
    expect(r.label).toBe('Window open (23h)');
  });

  it('rounds closing-soon minutes upward (no zero-minute display)', () => {
    // 30 seconds remain — must show "1m", never "0m".
    const at = new Date(NOW.getTime() + 30_000);
    const r = computeServiceWindow(at, NOW);
    expect(r.label).toBe('Closing soon (1m)');
  });

  it('accepts ISO string input', () => {
    const at = new Date(NOW.getTime() + 5 * 60 * 60_000).toISOString();
    const r = computeServiceWindow(at, NOW);
    expect(r.tone).toBe('open');
  });
});

describe('bumpServiceWindowOnInbound', () => {
  it('returns sentAt + 24h', () => {
    const r = bumpServiceWindowOnInbound(NOW);
    expect(r.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('bumpServiceWindowOnOutbound', () => {
  it('is a no-op (Meta rule: outbound does NOT extend)', () => {
    const at = new Date(NOW.getTime() + 5 * 60 * 60_000);
    expect(bumpServiceWindowOnOutbound(at)).toBe(at);
  });

  it('preserves null when window has never been opened', () => {
    expect(bumpServiceWindowOnOutbound(null)).toBe(null);
  });
});
