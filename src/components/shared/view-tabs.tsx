import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A row of pill links that switch a list between views — Upcoming /
 * Completed, Pending / Approved / Rejected — each with its count. Plain links,
 * so every view has its own URL and works without JavaScript.
 */
export function ViewTabs({ tabs, label }: { tabs: Array<{ href: string; label: string; count?: number; active: boolean }>; label: string }) {
  return (
    <nav aria-label={label} className="mb-5 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href as Route}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            tab.active
              ? "border-transparent bg-[linear-gradient(120deg,var(--brand-from),var(--primary))] text-white shadow-[0_6px_16px_-8px_var(--primary)]"
              : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className={cn("rounded-full px-1.5 text-xs tabular-nums", tab.active ? "bg-white/25" : "bg-muted")}>{tab.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
