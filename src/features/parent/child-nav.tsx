import type { Route } from "next";
import Link from "next/link";

import { PersonAvatar } from "@/components/shared/person-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rupees } from "@/features/finance/money";
import { ChevronRightIcon } from "lucide-react";

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
  { slug: "profile", label: "Profile" },
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
/** Today's register mark, in words a parent reads at a glance. */
const TODAY_LABEL: Record<string, { text: string; className: string }> = {
  PRESENT: { text: "Present today", className: "bg-success-soft text-success-strong" },
  LATE: { text: "Came late today", className: "bg-warning-soft text-warning-strong" },
  HALF_DAY: { text: "Half day today", className: "bg-warning-soft text-warning-strong" },
  ABSENT: { text: "Absent today", className: "bg-destructive/10 text-destructive" },
  EXCUSED: { text: "On leave today", className: "bg-muted text-muted-foreground" },
};

/**
 * One child at a glance: today's attendance in words, their attendance this
 * year, and what is still to pay. The whole card opens the child's page.
 */
export function ChildCard({
  child,
  attendanceShare,
  todayStatus,
  feesDueMinor = null,
}: {
  child: ChildOption & { admissionNumber: string; rollNumber: string | null; status: string; current?: boolean };
  attendanceShare: number | null;
  todayStatus: string | null;
  /** What is still to pay this session; null hides the line. */
  feesDueMinor?: number | null;
}) {
  // A child who has left is shown with their status and nothing to open: the
  // school no longer reports on them day to day. Siblings are unaffected.
  if (child.current === false) {
    return (
      <div className="bg-card/60 flex items-start gap-3 rounded-xl border border-dashed p-4">
        <PersonAvatar name={child.name} className="size-11 opacity-70" fallbackClassName="text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{child.name}</p>
          <p className="text-muted-foreground text-xs">No longer a current student. The school office holds their records.</p>
        </div>
        <StatusBadge status={child.status} />
      </div>
    );
  }
  const today = todayStatus ? TODAY_LABEL[todayStatus] : child.status === "ON_LEAVE" ? TODAY_LABEL.EXCUSED : null;
  return (
    <Link
      href={`/parent/children/${child.id}` as Route}
      className="hover:ring-primary/40 bg-card shadow-card hover:shadow-lift flex flex-col gap-4 rounded-2xl border border-border/70 p-4 transition-[box-shadow,transform] hover:-translate-y-0.5 hover:ring-2"
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={child.name} photoUrl={child.photoUrl} className="size-12" fallbackClassName="text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{child.name}</p>
          <p className="text-muted-foreground text-xs">
            {child.sectionLabel ?? "Not placed this session"}
            {child.rollNumber ? ` · roll ${child.rollNumber}` : ""}
          </p>
        </div>
        <ChevronRightIcon className="text-muted-foreground size-5 shrink-0" aria-hidden />
      </div>

      <p className={cn("rounded-xl px-3 py-2 text-sm font-semibold", today ? today.className : "bg-muted text-muted-foreground")}>
        {today ? today.text : "Today's attendance not marked yet"}
      </p>

      <dl className="grid grid-cols-2 gap-2">
        <div className="bg-muted/50 rounded-xl px-3 py-2">
          <dt className="text-muted-foreground text-xs">Attendance this year</dt>
          <dd className="text-lg font-bold tabular-nums">{attendanceShare === null ? "—" : `${Math.round(attendanceShare * 100)}%`}</dd>
        </div>
        {feesDueMinor !== null ? (
          <div className={cn("rounded-xl px-3 py-2", feesDueMinor > 0 ? "bg-warning-soft" : "bg-muted/50")}>
            <dt className="text-muted-foreground text-xs">Fees to pay</dt>
            <dd className={cn("text-lg font-bold tabular-nums", feesDueMinor > 0 && "text-warning-strong")}>{feesDueMinor > 0 ? rupees(feesDueMinor) : "Nothing due"}</dd>
          </div>
        ) : null}
      </dl>
    </Link>
  );
}
