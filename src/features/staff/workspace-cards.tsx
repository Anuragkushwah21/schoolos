import type { Route } from "next";
import Link from "next/link";

import { NAV_ICONS } from "@/components/shared/nav-icons";
import { WORKSPACES } from "@/lib/staff-workspaces";

/**
 * Staff, by kind, as cards: Teaching and Non-teaching. A card opens that
 * role's workspace — the modules the School Admin uses directly, as School
 * Admin. Used on the dashboard and on the Staff pages.
 */
export function WorkspaceCards({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-5">
      {(["TEACHING", "NON_TEACHING"] as const).map((category) => (
        <section key={category} aria-label={category === "TEACHING" ? "Teaching staff" : "Non-teaching staff"}>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">{category === "TEACHING" ? "Teaching staff" : "Non-teaching staff"}</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {WORKSPACES.filter((row) => row.category === category).map((row) => {
              const Icon = NAV_ICONS[row.icon];
              const count = row.roles.reduce((sum, role) => sum + (counts[role] ?? 0), 0);
              return (
                <li key={row.key}>
                  <Link
                    href={`/school-admin/staff/workspaces/${row.key}` as Route}
                    className="bg-card hover:border-primary/50 hover:bg-primary-soft flex h-full items-center gap-3 rounded-xl border p-3 transition-colors"
                  >
                    <span className="bg-primary-soft text-primary-strong flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.title}</span>
                      <span className="text-muted-foreground block text-xs">{count ? `${count} on staff` : "No one yet"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
