/**
 * A small RFC 4180 CSV reader for the import screens.
 *
 * Handles quoted fields, doubled quotes, commas and line breaks inside quotes,
 * CRLF or LF line endings and a leading byte-order mark (Excel adds one). No
 * dependency: the imports here are a few hundred rows at most.
 */

export type CsvRecord = { line: number; values: Record<string, string> };

export class CsvFormatError extends Error {}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new CsvFormatError("A quoted value is never closed.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines (often a trailing newline from Excel) are not records.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Normalise a header for matching: "Admission No." → "admission no". */
export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Rows keyed by normalised header. `line` is the 1-based line in the file, so
 * an error can say "row 7" and mean the row the user sees in Excel.
 */
export function readCsvRecords(text: string, options: { required: string[]; maxRows?: number }): CsvRecord[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new CsvFormatError("The file is empty.");
  const header = rows[0]!.map(headerKey);
  const missing = options.required.filter((name) => !header.includes(headerKey(name)));
  if (missing.length) {
    throw new CsvFormatError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }
  const maxRows = options.maxRows ?? 2000;
  if (rows.length - 1 > maxRows) throw new CsvFormatError(`At most ${maxRows} rows can be imported at once.`);

  return rows.slice(1).map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(header.map((key, column) => [key, (cells[column] ?? "").trim()])),
  }));
}
