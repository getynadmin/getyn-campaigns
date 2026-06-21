/**
 * Slugify a heading string for use as an HTML id. Lowercase, strip
 * non-alphanumerics, collapse runs of `-`. Idempotent.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ExtractedHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Walk a React node tree and collect every <h2> / <h3> we see, in
 * document order. Headings produced by the H2/H3 helpers in
 * articles.tsx are real DOM elements (not nested wrappers), so the
 * walk reliably finds them.
 *
 * Server-side safe — runs at SSG time on the article page, passes
 * the resulting list as a prop to the client TOC component.
 */
import type { ReactElement, ReactNode } from 'react';

export function extractHeadings(node: ReactNode): ExtractedHeading[] {
  const out: ExtractedHeading[] = [];
  walk(node, out);
  return out;
}

function isReactElement(node: unknown): node is ReactElement {
  return (
    typeof node === 'object' &&
    node !== null &&
    'type' in node &&
    'props' in node
  );
}

function walk(node: ReactNode, out: ExtractedHeading[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (!isReactElement(node)) return;

  const type = node.type;
  if (type === 'h2' || type === 'h3') {
    const props = node.props as {
      id?: string;
      children?: ReactNode;
    };
    const text = nodeToText(props.children);
    if (text) {
      out.push({
        id: props.id ?? slugifyHeading(text),
        text,
        level: type === 'h2' ? 2 : 3,
      });
    }
    return; // don't descend into headings further
  }

  const props = node.props as { children?: ReactNode };
  if (props && 'children' in props) {
    walk(props.children, out);
  }
}

function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean')
    return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (isReactElement(node)) {
    const props = node.props as { children?: ReactNode };
    return nodeToText(props.children);
  }
  return '';
}
