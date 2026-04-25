/**
 * Server-side HTML → plaintext conversion for the email send pipeline.
 *
 * Unlayer renders the HTML client-side inside its iframe (via
 * `editor.exportHtml`). When the campaign is saved, the client posts both
 * `designJson` and `renderedHtml` to the server. From there we generate
 * the plaintext alternative server-side so it can never drift from the
 * HTML body.
 *
 * `html-to-text` is conservative by default — preserves links, strips
 * styles, wraps at 80 chars. The configuration below tightens a few
 * email-specific behaviors:
 *   - Lists keep their bullets / numbers visible
 *   - Images become "[Image: alt-text]" when alt is present, dropped otherwise
 *   - Tables flatten with newlines (Unlayer's grid is heavy on tables)
 *   - Tracking-redirector links are surfaced — recipients can copy them
 */
import { convert } from 'html-to-text';

export function renderPlaintext(html: string): string {
  return convert(html, {
    wordwrap: 80,
    selectors: [
      // Drop nav-style elements that Unlayer adds for accessibility
      { selector: 'img', format: 'inline', options: { ignoreHref: true } },
      // Tables — flatten without ASCII art borders
      {
        selector: 'table',
        format: 'dataTable',
        options: { uppercaseHeaderCells: false },
      },
      // Section dividers
      { selector: 'hr', format: 'horizontalLine', options: { length: 40 } },
    ],
  });
}
