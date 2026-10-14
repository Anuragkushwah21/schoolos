"use client";

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, DownloadIcon, PrinterIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Waits until the page is ready to print: web fonts loaded and every image
 * finished (loaded or failed), up to a time limit. Returns how many images
 * failed, so a document is never printed or saved as PDF with a silently
 * missing photo, logo or signature.
 */
async function readyToPrint(timeoutMs = 10_000): Promise<{ failed: number }> {
  const images = [...document.querySelectorAll<HTMLImageElement>("main img")];
  const settle = Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    ...images.map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ]);
  await Promise.race([settle, new Promise((resolve) => window.setTimeout(resolve, timeoutMs))]);
  return { failed: images.filter((image) => !image.complete || image.naturalWidth === 0).length };
}

/**
 * Screen-only controls above a printable page (report card, documents). Carries
 * the `no-print` class, which the page's print CSS hides. "Save as PDF" is the
 * browser's own print destination, so it opens the same dialog — after the
 * fonts and images are ready.
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
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);

  const print = useCallback(async (force = false) => {
    setBusy(true);
    const result = await readyToPrint();
    setBusy(false);
    setFailed(result.failed);
    if (result.failed && !force) return;
    window.print();
  }, []);

  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => void print(), 300);
    return () => window.clearTimeout(timer);
  }, [autoPrint, print]);

  return (
    <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref as Route}>
            <ArrowLeftIcon className="size-4" aria-hidden />
            {backLabel}
          </Link>
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void print()} title="Choose “Save as PDF” as the printer">
            <DownloadIcon className="size-4" aria-hidden />
            {busy ? "Preparing…" : "Download PDF"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void print()}>
            <PrinterIcon className="size-4" aria-hidden />
            Print
          </Button>
        </div>
      </div>
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{failed === 1 ? "1 image (photo, logo or signature) did not load." : `${failed} images (photos, logos or signatures) did not load.`} Reload the page, or print without them.</span>
          <Button size="sm" variant="outline" onClick={() => void print(true)}>
            Print anyway
          </Button>
        </div>
      ) : null}
    </div>
  );
}
