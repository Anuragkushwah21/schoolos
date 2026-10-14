"use client";

import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;

/**
 * A paper preview at real size (CSS millimetres), with zoom. "Fit" scales the
 * page to the space available. For an A4 document it also counts how many
 * pages the document runs to, from its height against one A4 page. Printing
 * always uses 100 %.
 */
export function ZoomFrame({ children, pageWidthMm, a4 }: { children: React.ReactNode; pageWidthMm: number; a4?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pages, setPages] = useState<number | null>(null);

  const fit = () => {
    const box = outer.current;
    if (!box) return;
    const mm = box.clientWidth / ((pageWidthMm * 96) / 25.4);
    setZoom(Math.max(0.3, Math.min(1.5, Math.floor(mm * 20) / 20)));
  };

  // Start fitted to the space, so a phone sees the whole page.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (!a4 || !inner.current || !probe.current) return;
    const sheet = inner.current.querySelector<HTMLElement>(".document-sheet");
    if (!sheet) return;
    setPages(Math.max(1, Math.ceil(sheet.offsetHeight / probe.current.offsetHeight - 0.02)));
  }, [a4, children]);

  const step = (direction: 1 | -1) => {
    const index = STEPS.findIndex((value) => value >= zoom - 0.001);
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, (index === -1 ? STEPS.length - 1 : index) + direction))]!;
    setZoom(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print bg-card flex flex-wrap items-center gap-1.5 self-start rounded-xl border p-1 shadow-sm">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Zoom out">
          <MinusIcon aria-hidden />
        </Button>
        <span className="w-12 text-center text-sm font-semibold tabular-nums">{`${Math.round(zoom * 100)}%`}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Zoom in">
          <PlusIcon aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={fit}>
          <ScanIcon aria-hidden />
          Fit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setZoom(1)}>
          100%
        </Button>
        {pages !== null ? <span className="text-muted-foreground px-2 text-xs">{pages === 1 ? "1 page" : `${pages} pages`}</span> : null}
      </div>
      <div ref={outer} className="overflow-auto">
        <div ref={inner} className="zoom-frame relative w-fit" style={{ zoom }}>
          <div ref={probe} aria-hidden className="pointer-events-none invisible absolute h-[297mm] w-px" />
          {children}
        </div>
      </div>
    </div>
  );
}
