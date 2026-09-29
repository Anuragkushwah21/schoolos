import "server-only";

import { NextResponse } from "next/server";

import type { ReportTable } from "@/server/reports/exports";

/** Neutralise spreadsheet formula injection and quote every cell. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(table: ReportTable): string {
  return [table.head, ...table.rows].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

/**
 * A CSV download. The byte-order mark makes Excel read ₹ and Indian names as
 * UTF-8; `no-store` keeps a school's list out of any shared cache.
 */
export function csvResponse(filename: string, table: ReportTable): NextResponse {
  return new NextResponse(`﻿${toCsv(table)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9.\-]+/gi, "-").toLowerCase()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
