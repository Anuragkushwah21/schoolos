"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Screen-only controls above a printable page (report card, report). Carries
 * the `no-print` class, which the page's print CSS hides. "Save as PDF" is the
 * browser's own print destination, so it opens the same dialog.
 */
export function PrintToolbar({
  backHref,
  backLabel,
  autoPrint = false,
  children,
}: {
  backHref: string;
  backLabel: string;
  autoPrint?: boolean;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);

  return (
    <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref as Route}>
          <ArrowLeftIcon className="size-4" aria-hidden />
          {backLabel}
        </Link>
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button variant="outline" size="sm" onClick={() => window.print()} title="Choose “Save as PDF” as the printer">
          <DownloadIcon className="size-4" aria-hidden />
          Save as PDF
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <PrinterIcon className="size-4" aria-hidden />
          Print
        </Button>
      </div>
    </div>
  );
}
