/**
 * XLSX / XLS parser via SheetJS. Output shape mirrors the CSV parser
 * so downstream code (Audience Agent's `inspect_spreadsheet` tool)
 * doesn't need to know which it came from.
 *
 * Multi-sheet behaviour: capture all sheet names; use the first
 * non-empty sheet as the active one. Future iteration may let the
 * agent ask the user which sheet to use.
 */
import * as XLSX from 'xlsx';

import type {
  ColumnTypeGuess,
  SpreadsheetParsedContent,
} from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s().-]{7,}$/;
const URL_RE = /^https?:\/\//i;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;

function guessColumnType(values: string[]): ColumnTypeGuess {
  const sample = values
    .filter((v) => v && v.trim().length > 0)
    .slice(0, 20);
  if (sample.length === 0) return 'text';
  const tally = { email: 0, phone: 0, url: 0, number: 0, date: 0 };
  for (const v of sample) {
    const t = v.trim();
    if (EMAIL_RE.test(t)) tally.email++;
    else if (URL_RE.test(t)) tally.url++;
    else if (DATE_RE.test(t)) tally.date++;
    else if (NUMBER_RE.test(t)) tally.number++;
    else if (PHONE_RE.test(t)) tally.phone++;
  }
  const threshold = sample.length * 0.7;
  if (tally.email >= threshold) return 'email';
  if (tally.phone >= threshold) return 'phone';
  if (tally.url >= threshold) return 'url';
  if (tally.date >= threshold) return 'date';
  if (tally.number >= threshold) return 'number';
  return 'text';
}

export function parseXlsx(buf: Buffer): SpreadsheetParsedContent {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames;

  // Pick the first sheet that has any rows.
  let activeSheet: string | undefined;
  let rows: Array<Record<string, unknown>> = [];
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: '',
      raw: false,
    });
    if (parsed.length > 0) {
      activeSheet = name;
      rows = parsed;
      break;
    }
  }

  if (!activeSheet || rows.length === 0) {
    return {
      columns: [],
      rowCount: 0,
      sampleRows: [],
      columnTypeGuesses: {},
      sheetNames,
      activeSheet,
    };
  }

  const columns = Object.keys(rows[0] ?? {});
  const rowCount = rows.length;
  const sampleRows = rows.slice(0, 100).map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = String(r[c] ?? '');
    return out;
  });

  const columnValues: Record<string, string[]> = {};
  for (const c of columns) columnValues[c] = [];
  for (const r of rows.slice(0, 20)) {
    for (const c of columns) {
      columnValues[c]?.push(String(r[c] ?? ''));
    }
  }
  const columnTypeGuesses: Record<string, ColumnTypeGuess> = {};
  for (const c of columns) {
    columnTypeGuesses[c] = guessColumnType(columnValues[c] ?? []);
  }

  return {
    columns,
    rowCount,
    sampleRows,
    columnTypeGuesses,
    sheetNames,
    activeSheet,
  };
}
