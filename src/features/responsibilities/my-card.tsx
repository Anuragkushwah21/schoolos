import type { Route } from "next";
import Link from "next/link";
import { ChevronRightIcon, ClipboardListIcon } from "lucide-react";

import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { myResponsibilities } from "@/server/responsibilities/service";

/**
 * A dashboard row for the person's open responsibilities — shown only when
 * they have one, so an empty week stays quiet.
 */
export async function MyResponsibilitiesCard({ ctx, href }: { ctx: TenantContext; href: Route }) {
  const open = await myResponsibilities(ctx, false);
  if (!open.length) return null;
  const overdue = open.filter((row) => row.shownStatus === "OVERDUE").length;
  const next = open[0]!;
  return (
    <Link href={href} className="bg-card shadow-card hover:bg-muted/40 mb-6 flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 px-4 py-3 transition-colors">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-white", overdue ? "bg-danger" : "bg-primary")}>
        <ClipboardListIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{`My responsibilities · ${open.length} open${overdue ? `, ${overdue} overdue` : ""}`}</span>
        <span className="text-muted-foreground block truncate text-xs">{next.endDate ? `${next.title} · due ${formatDate(next.endDate)}` : next.title}</span>
      </span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
