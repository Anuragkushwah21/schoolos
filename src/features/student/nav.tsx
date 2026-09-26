import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Moving between the parts of a student's own record.
 *
 * Plain links, so each screen is bookmarkable and each one re-resolves the
 * signed-in student on the server. There is no id in any of these URLs: a
 * student has one record, so there is nothing for a request to name.
 */
const TABS = [
  { slug: "dashboard", label: "Today" },
  { slug: "classes", label: "Completed classes" },
  { slug: "upcoming", label: "Upcoming lessons" },
  { slug: "homework", label: "Homework" },
  { slug: "materials", label: "Study material" },
  { slug: "results", label: "Tests & results" },
  { slug: "attendance", label: "Attendance" },
  { slug: "remarks", label: "Teacher remarks" },
] as const;

export type StudentTab = (typeof TABS)[number]["slug"];

export function StudentTabs({ active }: { active: StudentTab }) {
  return (
    <nav aria-label="My record" className="mb-6 -mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const isActive = tab.slug === active;
        return (
          <Link
            key={tab.slug}
            href={`/student/${tab.slug}` as Route}
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
