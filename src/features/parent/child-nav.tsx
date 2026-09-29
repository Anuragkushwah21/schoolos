import type { Route } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Moving between children, and between one child's screens.
 *
 * Both are plain links rather than client state, so a parent can bookmark
 * "Priya's attendance" and land on it, and every screen re-resolves the child
 * through `requireChild` on the server. Hiding a child here would authorize
 * nothing; the list can only ever hold children the link table joins to this
 * guardian, because that is where it comes from.
 */

export type ChildOption = {
  id: string;
  name: string;
  sectionLabel: string | null;
  photoUrl: string | null;
};

/** The sections of one child's record. */
const TABS = [
  { slug: "", label: "Overview" },
  { slug: "attendance", label: "Attendance" },
  { slug: "timetable", label: "Timetable" },
  { slug: "activity", label: "Class activity" },
  { slug: "homework", label: "Homework" },
  { slug: "results", label: "Tests & results" },
  { slug: "fees", label: "Fees & payments" },
  { slug: "remarks", label: "Teacher remarks" },
  { slug: "reports", label: "Reports" },
] as const;

export type ChildTab = (typeof TABS)[number]["slug"];

export function ChildTabs({ studentId, active }: { studentId: string; active: ChildTab }) {
  return (
    <nav
      aria-label="This child's record"
      className="mb-6 -mx-1 flex gap-1 overflow-x-auto pb-1"
    >
      {TABS.map((tab) => {
        const href = (tab.slug ? `/parent/children/${studentId}/${tab.slug}` : `/parent/children/${studentId}`) as Route;
        const isActive = tab.slug === active;
        return (
          <Link
            key={tab.slug}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              isActive
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Which child is being looked at.
 *
 * Shown only when there is more than one — a guardian with a single child should
 * not have to pick them out of a list of one.
 */
export function ChildSwitcher({
  options,
  activeId,
  /** Which of the child's screens to stay on when switching. */
  tab,
}: {
  options: ChildOption[];
  activeId: string;
  tab: ChildTab;
}) {
  // A guardian with one child should not have to pick them out of a list of one.
  if (options.length < 2) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs">Showing</span>
      {options.map((child) => {
        const href = (tab ? `/parent/children/${child.id}/${tab}` : `/parent/children/${child.id}`) as Route;
        const isActive = child.id === activeId;
        return (
          <Button
            key={child.id}
            asChild
            size="sm"
            variant={isActive ? "default" : "outline"}
            aria-current={isActive ? "true" : undefined}
          >
            <Link href={href}>
              {child.name}
              {child.sectionLabel ? (
                <span className="opacity-70">· {child.sectionLabel}</span>
              ) : null}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

/** One child, as a card on the dashboard and the children list. */
export function ChildCard({
  child,
  attendanceShare,
  todayStatus,
}: {
  child: ChildOption & { admissionNumber: string; rollNumber: string | null; status: string; current?: boolean };
  attendanceShare: number | null;
  todayStatus: string | null;
}) {
  // A child who has left is shown with their status and nothing to open: the
  // school no longer reports on them day to day. Siblings are unaffected.
  if (child.current === false) {
    return (
      <div className="bg-card/60 flex items-start gap-3 rounded-xl border border-dashed p-4">
        <span className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-medium" aria-hidden>
          {child.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{child.name}</p>
          <p className="text-muted-foreground text-xs">No longer a current student. The school office holds their records.</p>
        </div>
        <StatusBadge status={child.status} />
      </div>
    );
  }
  return (
    <Link
      href={`/parent/children/${child.id}` as Route}
      className="hover:ring-primary/40 bg-card flex flex-col gap-3 rounded-xl border p-4 transition-shadow hover:ring-2"
    >
      <div className="flex items-start gap-3">
        {child.photoUrl ? (
          // A school-supplied URL; there is no upload pipeline in V1.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={child.photoUrl} alt="" className="size-11 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-medium"
            aria-hidden
          >
            {child.name.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{child.name}</p>
          <p className="text-muted-foreground text-xs">
            {child.sectionLabel ?? "Not placed this session"}
            {child.rollNumber ? ` · roll ${child.rollNumber}` : ""}
          </p>
        </div>
        {todayStatus ? <StatusBadge status={todayStatus} /> : child.status === "ON_LEAVE" ? <StatusBadge status="ON_LEAVE" /> : null}
      </div>

      <dl className="flex items-baseline gap-2">
        <dt className="text-muted-foreground text-xs">Attendance</dt>
        <dd className="text-lg font-semibold tabular-nums">
          {attendanceShare === null ? "—" : `${Math.round(attendanceShare * 100)}%`}
        </dd>
      </dl>
    </Link>
  );
}
