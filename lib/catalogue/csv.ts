/**
 * A small, correct CSV reader.
 *
 * Splitting on commas is wrong for exactly the files customers send: product
 * descriptions contain commas, addresses contain quoted commas, and Excel emits
 * CRLF with `""` for an embedded quote. Getting this wrong corrupts the
 * catalogue silently, which is worse than refusing the file, so this handles
 * quoting properly rather than approximately.
 *
 * No dependency added — rule 1's spirit is that this project stays cheap to
 * run, and a 60-line parser beats another package in node_modules.
 */

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\r") {
      // Swallow; the \n that follows ends the record.
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}
