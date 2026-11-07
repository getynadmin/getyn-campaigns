/**
 * Turn an Unlayer-style designJson into a single HTML string for
 * preview. Handles both the AI "html" block path and the older
 * row/column/"text" block path. Returns an empty string for
 * unrecognised shapes.
 */
type Content = {
  type?: string;
  values?: { html?: string; text?: string };
};
type Column = { contents?: Content[] };
type Row = { columns?: Column[] };
type Body = { rows?: Row[] };
type Design = { body?: Body };

export function renderTemplateHtml(design: unknown): string {
  const d = design as Design;
  const rows = d?.body?.rows;
  if (!Array.isArray(rows)) return '';
  const parts: string[] = [];
  for (const row of rows) {
    for (const col of row.columns ?? []) {
      for (const content of col.contents ?? []) {
        const v = content.values;
        if (content.type === 'html' && typeof v?.html === 'string') {
          parts.push(v.html);
        } else if (content.type === 'text' && typeof v?.text === 'string') {
          parts.push(v.text);
        }
      }
    }
  }
  return parts.join('\n');
}
