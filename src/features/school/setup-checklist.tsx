import type { Route } from "next";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The order a school has to be set up in, shown until it is.
 *
 * Each step exists because the next one cannot be done without it: a section
 * needs a class, a class needs a current session, a register needs students and
 * a teacher assigned to them. An administrator opening a brand-new school has
 * no way to know that order, and finding out by hitting one blocked screen
 * after another is a poor first hour.
 *
 * It disappears once every step is done, so an established school never sees
 * it. Nothing here authorizes anything — each page behind these links runs its
 * own checks.
 */
export type SetupState = {
  hasSession: boolean;
  hasClasses: boolean;
  hasSections: boolean;
  hasTeachers: boolean;
  hasStudents: boolean;
};

type Step = {
  done: boolean;
  title: string;
  body: string;
  href: Route;
  cta: string;
};

export function isSetUp(state: SetupState): boolean {
  return Object.values(state).every(Boolean);
}

export function SetupChecklist({ state }: { state: SetupState }) {
  const steps: Step[] = [
    {
      done: state.hasSession,
      title: "Make an academic session current",
      body: "Everything else belongs to a session — classes, sections, the timetable, every register and every placement.",
      href: "/school-admin/academics",
      cta: "Academics",
    },
    {
      done: state.hasClasses,
      title: "Create your classes",
      body: "Nursery through Class 12, or whichever of them this school runs. Streams are optional and configurable.",
      href: "/school-admin/academics/classes",
      cta: "Classes & sections",
    },
    {
      done: state.hasSections,
      title: "Add a section to each class",
      body: "A section is the group a student actually sits in, and the unit a register and a timetable are drawn for.",
      href: "/school-admin/academics/classes",
      cta: "Classes & sections",
    },
    {
      done: state.hasTeachers,
      title: "Add your teachers",
      body: "Each one gets a sign-in with their staff record. Assign them subjects afterwards — that is what lets them mark a register.",
      href: "/school-admin/teachers/new",
      cta: "Add a teacher",
    },
    {
      done: state.hasStudents,
      title: "Admit your students",
      body: "Add them directly, with a parent at the same time, or accept an online application under Admissions.",
      href: "/school-admin/students/new",
      cta: "Add a student",
    },
  ];

  const done = steps.filter((step) => step.done).length;
  // The first thing still to do. Everything else stays visible but quiet, so
  // the order is legible without being a wall of buttons.
  const next = steps.find((step) => !step.done);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Finish setting up your school</CardTitle>
        <CardDescription>
          {done} of {steps.length} done. Each step unlocks the one after it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-1">
          {steps.map((step) => {
            const isNext = step === next;
            return (
              <li
                key={step.title}
                className={
                  isNext
                    ? "bg-muted/60 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-3 py-3"
                    : "flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2"
                }
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {step.done ? (
                    <CheckIcon
                      className="size-4"
                      style={{ color: "var(--viz-good)" }}
                      aria-label="Done"
                    />
                  ) : (
                    <span
                      className="border-muted-foreground/40 size-3 rounded-full border"
                      aria-label="Still to do"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      step.done
                        ? "text-muted-foreground block text-sm line-through"
                        : "block text-sm font-medium"
                    }
                  >
                    {step.title}
                  </span>
                  {isNext ? (
                    <span className="text-muted-foreground block text-xs">{step.body}</span>
                  ) : null}
                </span>
                {isNext ? (
                  <Button asChild size="sm">
                    <Link href={step.href}>{step.cta}</Link>
                  </Button>
                ) : step.done ? null : (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={step.href}>{step.cta}</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
