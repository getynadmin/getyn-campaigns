/**
 * Per-recipient template variable resolution (Phase 4 M8).
 *
 * Campaign-side templateVariables is stored as an array of
 * { type, value } entries aligned with {{1}}, {{2}}, ... in the
 * BODY (and optionally the HEADER text). At dispatch time we
 * resolve `merge` types against the recipient's contact fields
 * and `static` types pass through verbatim.
 *
 * Returns the array of resolved string values ready for Meta's
 * components.parameters payload.
 */

export interface CampaignTemplateVar {
  type: 'static' | 'merge';
  value: string;
}

export interface ContactForResolution {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customFields?: Record<string, unknown> | null;
}

/**
 * Merge tags supported in Phase 4 M8. The list is intentionally
 * narrow — extending it requires consumer-side schema updates.
 *
 *   contact.firstName
 *   contact.lastName
 *   contact.fullName    (firstName + " " + lastName, trimmed)
 *   contact.email
 *   contact.phone
 *   contact.custom.<key>   (lookup into customFields JSON)
 */
function lookupMergeTag(
  path: string,
  contact: ContactForResolution,
): string {
  if (path === 'contact.firstName') return contact.firstName ?? '';
  if (path === 'contact.lastName') return contact.lastName ?? '';
  if (path === 'contact.fullName') {
    return `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
  }
  if (path === 'contact.email') return contact.email ?? '';
  if (path === 'contact.phone') return contact.phone ?? '';
  if (path.startsWith('contact.custom.')) {
    const key = path.slice('contact.custom.'.length);
    const v = contact.customFields?.[key];
    return v == null ? '' : String(v);
  }
  // Unknown path — fall through to empty rather than throw, so a
  // typo in one variable doesn't fail the whole batch. Worker logs
  // the empty resolution count for tenant visibility.
  return '';
}

export interface ResolutionResult {
  values: string[];
  /** Indices that resolved to empty — surfaced to logs for visibility. */
  emptyIndices: number[];
}

export function resolveTemplateVariables(
  vars: CampaignTemplateVar[],
  contact: ContactForResolution,
): ResolutionResult {
  const values: string[] = [];
  const emptyIndices: number[] = [];
  vars.forEach((v, i) => {
    let resolved: string;
    if (v.type === 'static') {
      resolved = v.value;
    } else {
      resolved = lookupMergeTag(v.value, contact);
    }
    if (resolved.length === 0) emptyIndices.push(i);
    // Meta rejects > 1024 chars per body parameter; clamp defensively.
    values.push(resolved.slice(0, 1024));
  });
  return { values, emptyIndices };
}
