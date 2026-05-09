/**
 * Phase 4 M8 / M12 — template variable resolver coverage.
 *
 * The dispatch handler resolves `templateVariables` per recipient at
 * send time. Bugs here send wrong content — high-value tests.
 *
 * Covered:
 *   - static values pass through verbatim
 *   - merge tags resolve standard contact fields
 *   - fullName trims correctly when one half is missing
 *   - custom-field lookups via contact.custom.<key>
 *   - unknown merge tags resolve empty (typo-safe) and surface as
 *     emptyIndices
 *   - resolution clamps long values to 1024 chars (Meta's per-param limit)
 *   - empty arrays return cleanly
 */
import {
  resolveTemplateVariables,
  type CampaignTemplateVar,
  type ContactForResolution,
} from '@getyn/whatsapp';
import { describe, expect, it } from 'vitest';

const ana: ContactForResolution = {
  firstName: 'Ana',
  lastName: 'Lopez',
  email: 'ana@example.com',
  phone: '+14155551001',
  customFields: { plan: 'pro', mrr: 49 },
};

describe('resolveTemplateVariables', () => {
  it('passes static values verbatim', () => {
    const vars: CampaignTemplateVar[] = [
      { type: 'static', value: 'Hello' },
      { type: 'static', value: 'World' },
    ];
    const r = resolveTemplateVariables(vars, ana);
    expect(r.values).toEqual(['Hello', 'World']);
    expect(r.emptyIndices).toEqual([]);
  });

  it('resolves contact.firstName / lastName / email / phone', () => {
    const vars: CampaignTemplateVar[] = [
      { type: 'merge', value: 'contact.firstName' },
      { type: 'merge', value: 'contact.lastName' },
      { type: 'merge', value: 'contact.email' },
      { type: 'merge', value: 'contact.phone' },
    ];
    const r = resolveTemplateVariables(vars, ana);
    expect(r.values).toEqual([
      'Ana',
      'Lopez',
      'ana@example.com',
      '+14155551001',
    ]);
  });

  it('builds fullName from both halves', () => {
    const r = resolveTemplateVariables(
      [{ type: 'merge', value: 'contact.fullName' }],
      ana,
    );
    expect(r.values[0]).toBe('Ana Lopez');
  });

  it('trims fullName when one half is missing', () => {
    const onlyFirst = { ...ana, lastName: null };
    const r = resolveTemplateVariables(
      [{ type: 'merge', value: 'contact.fullName' }],
      onlyFirst,
    );
    expect(r.values[0]).toBe('Ana');
    expect(r.emptyIndices).toEqual([]);
  });

  it('resolves contact.custom.<key> for primitive customFields', () => {
    const vars: CampaignTemplateVar[] = [
      { type: 'merge', value: 'contact.custom.plan' },
      { type: 'merge', value: 'contact.custom.mrr' },
    ];
    const r = resolveTemplateVariables(vars, ana);
    expect(r.values).toEqual(['pro', '49']);
  });

  it('unknown merge tags resolve empty without throwing', () => {
    const vars: CampaignTemplateVar[] = [
      { type: 'merge', value: 'contact.zip' }, // not supported
      { type: 'merge', value: 'company.name' }, // not a contact field
    ];
    const r = resolveTemplateVariables(vars, ana);
    expect(r.values).toEqual(['', '']);
    expect(r.emptyIndices).toEqual([0, 1]);
  });

  it('null / undefined contact fields surface in emptyIndices', () => {
    const blank = {
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      customFields: null,
    } satisfies ContactForResolution;
    const vars: CampaignTemplateVar[] = [
      { type: 'static', value: 'STATIC' }, // index 0 — not empty
      { type: 'merge', value: 'contact.firstName' }, // empty
      { type: 'merge', value: 'contact.email' }, // empty
    ];
    const r = resolveTemplateVariables(vars, blank);
    expect(r.values[0]).toBe('STATIC');
    expect(r.emptyIndices).toEqual([1, 2]);
  });

  it('clamps oversized values to 1024 chars (Meta param limit)', () => {
    const huge = 'x'.repeat(5000);
    const r = resolveTemplateVariables(
      [{ type: 'static', value: huge }],
      ana,
    );
    expect(r.values[0]?.length).toBe(1024);
  });

  it('empty input array returns empty result', () => {
    const r = resolveTemplateVariables([], ana);
    expect(r.values).toEqual([]);
    expect(r.emptyIndices).toEqual([]);
  });

  it('contact.custom on missing customFields is empty (no throw)', () => {
    const noCustom = { ...ana, customFields: null };
    const r = resolveTemplateVariables(
      [{ type: 'merge', value: 'contact.custom.plan' }],
      noCustom,
    );
    expect(r.values).toEqual(['']);
    expect(r.emptyIndices).toEqual([0]);
  });
});
