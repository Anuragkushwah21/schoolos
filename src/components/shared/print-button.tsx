"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Print the current page; the app shell and filters are hidden by print CSS. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="no-print">
      <PrinterIcon className="size-4" aria-hidden />
      {label}
    </Button>
  );
}
