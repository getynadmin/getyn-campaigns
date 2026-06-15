/**
 * CSV parser: header sniffing, 100-row sample, total row count,
 * per-column type guess.
 *
 * Streaming via papaparse's parse(string, { step }) — fully buffers
 * in memory but only retains 100 rows and the count. We never load
 * the whole sheet into JS objects.
 */
import Papa from 'papaparse';

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
  const total = sample.length;
  // "Mostly" = >=70% — leaves room for stray empties/typos.
  const threshold = total * 0.7;
  if (tally.email >= threshold) return 'email';
  if (tally.phone >= threshold) return 'phone';
  if (tally.url >= threshold) return 'url';
  if (tally.date >= threshold) return 'date';
  if (tally.number >= threshold) return 'number';
  return 'text';
}

export function parseCsv(buf: Buffer): SpreadsheetParsedContent {
  const text = buf.toString('utf8');
  const sampleRows: Array<Record<string, string>> = [];
  const columnValues: Record<string, string[]> = {};
  let columns: string[] = [];
  let rowCount = 0;

  // Synchronous parse so we don't have to thread async through the
  // worker handler. papaparse buffers 10MB CSVs in microseconds.
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  for (const row of result.data) {
    rowCount += 1;
    if (rowCount === 1) {
      columns = Object.keys(row);
      for (const c of columns) columnValues[c] = [];
    }
    if (sampleRows.length < 100) sampleRows.push(row);
    // Collect first 20 values per column for the type guess.
    for (const c of columns) {
      const bucket = columnValues[c];
      if (bucket && bucket.length < 20) {
        bucket.push(row[c] ?? '');
      }
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
  };
}
