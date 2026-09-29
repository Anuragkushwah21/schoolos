"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ReceiptFormat } from "./receipt";

/**
 * Screen-only controls above a receipt. Hidden when printing, so the paper
 * carries the receipt and nothing else.
 *
 * "Save as PDF" opens the same print dialog: every current browser offers
 * "Save as PDF" as a destination there, which gives a faithful copy without a
 * PDF library on the server.
 */
export function ReceiptToolbar({
  backHref,
  backLabel,
  format,
  paymentId,
  autoPrint,
}: {
  backHref: string;
  backLabel: string;
  format: ReceiptFormat;
  paymentId: string;
  autoPrint: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    // Let the logo load before the dialog snapshots the page.
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);

  const formatHref = (next: ReceiptFormat) => `/receipts/${paymentId}${next === "slip" ? "?format=slip" : ""}` as Route;

  return (
    <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref as Route}>
          <ArrowLeftIcon className="size-4" aria-hidden />
          {backLabel}
        </Link>
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5 text-sm" role="group" aria-label="Receipt size">
          {(["a4", "slip"] as const).map((option) => (
            <Link
              key={option}
              href={formatHref(option)}
              aria-current={format === option ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1",
                format === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "a4" ? "A4" : "Compact slip"}
            </Link>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()} title="Choose “Save as PDF” as the printer">
          <DownloadIcon className="size-4" aria-hidden />
          Save as PDF
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <PrinterIcon className="size-4" aria-hidden />
          Print receipt
        </Button>
      </div>
    </div>
  );
}
