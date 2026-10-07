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

export interface CsvLimits { columns: number; rawRows: number; cellCharacters: number }

export function parseCsv(input: string, limits?: CsvLimits, strict = false): CsvTable {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let closedQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    // Enforce structural limits while scanning, before constructing row objects.
    if (limits && (record.length >= limits.columns || records.length >= limits.rawRows || field.length > limits.cellCharacters)) {
      throw new Error("CSV exceeds column, raw-row, or cell limit.");
    }
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (strict && closedQuote && char !== "," && char !== "\r" && char !== "\n") throw new Error("Invalid CSV quoting.");
    if (char === '"') {
      if (strict && field.length) throw new Error("Invalid CSV quoting.");
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\r") {
      // Swallow; the \n that follows ends the record.
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      closedQuote = false;
    } else {
      field += char;
    }
  }

  if (strict && inQuotes) throw new Error("Unclosed CSV quote.");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (limits && (record.length > limits.columns || records.length > limits.rawRows || field.length > limits.cellCharacters || records.some((r) => r.length > limits.columns || r.some((c) => c.length > limits.cellCharacters)))) {
    throw new Error("CSV exceeds column, raw-row, or cell limit.");
  }
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = nonEmpty.slice(1).map((cells) => {
    if (strict && cells.length !== headers.length) throw new Error("Invalid CSV row width.");
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}
