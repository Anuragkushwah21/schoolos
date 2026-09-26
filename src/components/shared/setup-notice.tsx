import type { Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

/**
 * What a School Admin sees when the thing they opened needs something set up
 * first.
 *
 * Nearly everything in a school hangs off a current academic session, and a
 * student hangs off a section inside it. A screen that just says so is a dead
 * end: the admin is told what is wrong and left with nothing to click. This
 * names the missing step and links straight to where it is made, so the first
 * hour in a new school is a chain of buttons rather than a hunt.
 *
 * The step order is the real dependency order — session, then classes and
 * sections, then people — so following the link always moves forward.
 */
const STEPS = {
  session: {
    title: "No academic session is current yet",
    body: "Classes, sections, timetables, attendance and every student placement belong to a session, so this is the first thing a school sets up.",
    href: "/school-admin/academics" as Route,
    label: "Set up the session",
  },
  sections: {
    title: "No sections in this session yet",
    body: "A student is always placed in a section, and a timetable is always drawn for one. Create the classes first, then a section inside each.",
    href: "/school-admin/academics/classes" as Route,
    label: "Create classes & sections",
  },
  teachers: {
    title: "No teachers yet",
    body: "Add the staff first: a timetable, a register and a subject assignment all need somebody to belong to.",
    href: "/school-admin/teachers/new" as Route,
    label: "Add a teacher",
  },
  students: {
    title: "No students yet",
    body: "Admit a student directly, or accept an online application under Admissions.",
    href: "/school-admin/students/new" as Route,
    label: "Add a student",
  },
} as const;

export type SetupStep = keyof typeof STEPS;

export function SetupNotice({
  title,
  need,
  back,
  children,
}: {
  /** The page's own heading, so the admin keeps their bearings. */
  title: string;
  need: SetupStep;
  back?: { href: Route; label: string };
  /** Overrides the step's default explanation where a page needs its own. */
  children?: React.ReactNode;
}) {
  const step = STEPS[need];

  return (
    <>
      <PageHeader title={title} back={back} />
      <EmptyState
        title={step.title}
        action={
          <Button asChild size="sm">
            <Link href={step.href}>{step.label}</Link>
          </Button>
        }
      >
        {children ?? step.body}
      </EmptyState>
    </>
  );
}
