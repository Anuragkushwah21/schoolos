"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The five dashboards, as tabs. Each screenshot is the real app on the Live
 * Demo's fictional school; each point is something that role can do there.
 */
const ROLES = [
  {
    key: "admin",
    label: "School Admin",
    image: { src: "/marketing/admin-dashboard.png", phone: false, alt: "School Admin dashboard: today's admissions, fee collection, attendance and pending actions." },
    points: ["Students, staff, classes and the timetable", "Today's attendance, fee collection and pending actions", "Exams, results and fee reports", "Setup checklist, website and school settings"],
  },
  {
    key: "principal",
    label: "Principal",
    image: { src: "/marketing/principal-dashboard.png", phone: false, alt: "Principal dashboard: students, teachers, attendance, class performance and quick actions." },
    points: ["Academic progress, class and subject performance", "Verify results before they are published", "Assign responsibilities to staff and follow them up", "Notices, meetings and reports — without collecting fees"],
  },
  {
    key: "teacher",
    label: "Teacher",
    image: { src: "/marketing/teacher-dashboard.png", phone: false, alt: "Teacher dashboard: today's classes, attendance to take and quick actions." },
    points: ["Today's classes and the register to take", "Homework and tests for their own sections", "Marks entry, submitted for verification", "Leave requests and their responsibilities"],
  },
  {
    key: "parent",
    label: "Parent",
    image: { src: "/marketing/parent-dashboard.png", phone: true, alt: "Parent dashboard on a phone: both children with attendance and fees to pay." },
    points: ["All their children in one login", "Today's attendance and the year so far", "Homework, notices and published results", "Fee statement: due, paid and pending"],
  },
  {
    key: "student",
    label: "Student",
    image: { src: "/marketing/student-dashboard.png", phone: true, alt: "Student dashboard on a phone: today, attendance, homework and latest test." },
    points: ["Today's timetable and classes", "Their own attendance", "Homework and published results", "No fees — those stay with parents"],
  },
] as const;

export function RolePreview() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const role = ROLES[active]!;

  function onKey(event: React.KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + ROLES.length) % ROLES.length;
    setActive(next);
    tabs.current[next]?.focus();
  }

  return (
    <div className="mt-12 flex flex-col gap-8">
      <div role="tablist" aria-label="Choose a role" className="mx-auto flex max-w-full flex-wrap justify-center gap-2">
        {ROLES.map((item, index) => (
          <button
            key={item.key}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`role-tab-${item.key}`}
            aria-selected={index === active}
            aria-controls={`role-panel-${item.key}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => onKey(event, index)}
            className={cn(
              "focus-visible:ring-ring rounded-full border px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 motion-safe:transition-colors",
              index === active ? "bg-primary text-primary-foreground border-transparent" : "bg-card hover:bg-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`role-panel-${role.key}`} aria-labelledby={`role-tab-${role.key}`} className="grid items-center gap-8 lg:grid-cols-[1fr_1.6fr]">
        <div className="flex flex-col gap-4">
          <h3 className="text-2xl font-bold">{role.label}</h3>
          <ul className="flex flex-col gap-2.5">
            {role.points.map((point) => (
              <li key={point} className="flex gap-2">
                <CheckIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="text-muted-foreground">{point}</span>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="w-fit">
            <Link href="/demo">
              Try it as {role.label}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </div>
        <div className="flex justify-center">
          {role.image.phone ? (
            <figure className="bg-card shadow-lift w-[260px] overflow-hidden rounded-[2rem] border-[6px] border-slate-900 dark:border-slate-700">
              <Image key={role.key} src={role.image.src} alt={role.image.alt} width={780} height={1688} sizes="260px" className="h-auto w-full" />
            </figure>
          ) : (
            <figure className="bg-card shadow-lift w-full overflow-hidden rounded-2xl border border-border/70">
              <div aria-hidden className="bg-muted/60 flex h-8 items-center gap-1.5 border-b px-3">
                <span className="size-2.5 rounded-full bg-red-400/80" />
                <span className="size-2.5 rounded-full bg-amber-400/80" />
                <span className="size-2.5 rounded-full bg-green-400/80" />
              </div>
              <Image key={role.key} src={role.image.src} alt={role.image.alt} width={2880} height={1800} sizes="(min-width: 1024px) 680px, 100vw" className="h-auto w-full" />
            </figure>
          )}
        </div>
      </div>
    </div>
  );
}
