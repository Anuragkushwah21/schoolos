"use client";

import Link from "next/link";
import { useActionState, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, CompassIcon, LogOutIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

import { exitDemoAction, resetDemoAction, startDemoAction, switchDemoPlanAction, switchDemoRoleAction } from "./actions";

type Result = ActionResult<undefined>;
const idle: Result = { status: "idle" };

/** "Explore as …" on the demo page. */
export function StartDemoButton({ role, label, primary = false, plan = "" }: { role: string; label: string; primary?: boolean; plan?: string }) {
  const [state, action, pending] = useActionState(startDemoAction, idle);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="plan" value={plan} />
      <Button type="submit" disabled={pending} variant={primary ? "default" : "outline"} className="w-full">
        {pending ? (
          <>
            <Spinner size="xs" /> Preparing your demo school…
          </>
        ) : (
          label
        )}
      </Button>
      {state.status === "error" ? <p className="text-danger-strong text-xs">{state.message}</p> : null}
    </form>
  );
}

const ROLE_OPTIONS = [
  { value: "SCHOOL_ADMIN", label: "School Admin" },
  { value: "PRINCIPAL", label: "Principal" },
  { value: "TEACHER", label: "Teacher" },
  { value: "PARENT", label: "Parent" },
  { value: "STUDENT", label: "Student" },
  { value: "ACCOUNTANT", label: "Accountant" },
];

const TOUR: Record<string, Array<{ label: string; href: string }>> = {
  SCHOOL_ADMIN: [
    { label: "Explore the dashboard", href: "/school-admin/dashboard" },
    { label: "View students", href: "/school-admin/students" },
    { label: "Mark attendance", href: "/school-admin/attendance" },
    { label: "Exams and results", href: "/school-admin/exams/term" },
    { label: "Fee reports", href: "/school-admin/finance/reports" },
    { label: "Then switch to Parent", href: "#role" },
  ],
  PRINCIPAL: [
    { label: "Principal dashboard", href: "/principal/dashboard" },
    { label: "Verify Unit Test 2", href: "/school-admin/exams/term" },
    { label: "Responsibilities", href: "/school-admin/responsibilities" },
    { label: "Reports", href: "/school-admin/reports" },
  ],
  TEACHER: [
    { label: "My dashboard", href: "/teacher/dashboard" },
    { label: "Take attendance", href: "/teacher/attendance" },
    { label: "Set homework", href: "/teacher/homework" },
    { label: "Tests and marks", href: "/teacher/exams" },
    { label: "My responsibilities", href: "/teacher/responsibilities" },
  ],
  PARENT: [
    { label: "Family dashboard", href: "/parent/dashboard" },
    { label: "Published results", href: "/parent/results" },
    { label: "Fees and statement", href: "/parent/fees" },
    { label: "Notices", href: "/parent/notices" },
  ],
  STUDENT: [
    { label: "My day", href: "/student/dashboard" },
    { label: "Timetable", href: "/student/timetable" },
    { label: "Homework", href: "/student/homework" },
    { label: "Results", href: "/student/results" },
  ],
  ACCOUNTANT: [
    { label: "Dashboard", href: "/staff/dashboard" },
    { label: "Collect a fee", href: "/staff/fees" },
    { label: "Fee reports", href: "/staff/fees/reports" },
  ],
};

const TOUR_KEY = "schoolos-demo-tour";
let tourClosedInMemory = false;
function subscribeTour(onChange: () => void) {
  window.addEventListener(TOUR_KEY, onChange);
  return () => window.removeEventListener(TOUR_KEY, onChange);
}
function readTourOpen(): boolean {
  if (tourClosedInMemory) return false;
  try {
    return window.localStorage.getItem(TOUR_KEY) !== "closed";
  } catch {
    return true;
  }
}
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
function currentMinute(): number {
  return Math.floor(Date.now() / 60000);
}

/**
 * The bar shown on every page of the Live Demo: sample data only, who you are,
 * switch role, start over, leave — and a short, skippable tour. Every choice
 * goes to the server, which checks the session belongs to a demo sandbox.
 */
export function DemoBanner({ role, expiresAt, plans = [], currentPlan = null }: { role: string; expiresAt: string | null; plans?: Array<{ slug: string; name: string }>; currentPlan?: string | null }) {
  const [planState, planAction, planSwitching] = useActionState(switchDemoPlanAction, idle);
  const [switchState, switchAction, switching] = useActionState(switchDemoRoleAction, idle);
  const [resetState, resetAction, resetting] = useActionState(resetDemoAction, idle);
  // Read from the browser after hydration; the server renders the tour closed.
  const tourOpen = useSyncExternalStore(subscribeTour, readTourOpen, () => false);
  const closeTour = () => {
    try {
      window.localStorage.setItem(TOUR_KEY, "closed");
    } catch {
      tourClosedInMemory = true; // private window: closes for this page view
    }
    window.dispatchEvent(new Event(TOUR_KEY));
  };
  const openTour = () => {
    tourClosedInMemory = false;
    try {
      window.localStorage.removeItem(TOUR_KEY);
    } catch {
      /* nothing stored to clear */
    }
    window.dispatchEvent(new Event(TOUR_KEY));
  };
  const nowMinute = useSyncExternalStore(subscribeMinute, currentMinute, () => null);
  const minutes = expiresAt && nowMinute !== null ? Math.max(0, Math.round(new Date(expiresAt).getTime() / 60000 - nowMinute)) : null;
  const steps = TOUR[role] ?? [];
  return (
    <div className="print:hidden">
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
        <strong className="tracking-wide">DEMO MODE — Sample Data Only</strong>
        <span className="hidden sm:inline">{`Green Valley Demo School is fictional. Nothing here is sent or charged.${minutes !== null ? ` Resets in about ${minutes} min.` : ""}`}</span>
        <form id="role" action={switchAction} className="flex items-center gap-1.5">
          <label htmlFor="demo-role" className="text-xs">
            Viewing as
          </label>
          <select id="demo-role" name="role" defaultValue={role} onChange={(event) => event.currentTarget.form?.requestSubmit()} disabled={switching} className="rounded border border-amber-400 bg-white px-1.5 py-0.5 text-xs text-black">
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {switching ? <Spinner size="xs" /> : null}
        </form>
        {plans.length ? (
          <form action={planAction} className="flex items-center gap-1.5">
            <label htmlFor="demo-plan" className="text-xs">
              Plan
            </label>
            <select id="demo-plan" name="plan" defaultValue={currentPlan ?? ""} onChange={(event) => event.currentTarget.form?.requestSubmit()} disabled={planSwitching} className="rounded border border-amber-400 bg-white px-1.5 py-0.5 text-xs text-black">
              {currentPlan ? null : <option value="">Choose…</option>}
              {plans.map((plan) => (
                <option key={plan.slug} value={plan.slug}>
                  {plan.name}
                </option>
              ))}
            </select>
            {planSwitching ? <Spinner size="xs" /> : null}
            <Link href="/demo#compare" className="text-xs underline">
              Compare plans
            </Link>
            {planState.status === "error" ? <span className="text-xs text-red-700">{planState.message}</span> : null}
          </form>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {steps.length && !tourOpen ? (
            <button type="button" onClick={openTour} className="inline-flex items-center gap-1 text-xs font-medium underline">
              <CompassIcon className="size-3.5" aria-hidden /> Tour
            </button>
          ) : null}
          <form action={resetAction}>
            <button type="submit" disabled={resetting} className="inline-flex items-center gap-1 text-xs font-medium underline">
              <RotateCcwIcon className="size-3.5" aria-hidden /> {resetting ? "Resetting…" : "Start over"}
            </button>
          </form>
          <form action={exitDemoAction}>
            <button type="submit" className="inline-flex items-center gap-1 text-xs font-medium underline">
              <LogOutIcon className="size-3.5" aria-hidden /> Exit demo
            </button>
          </form>
          <Link href="/register" className="rounded-md bg-amber-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950">
            Register your school
          </Link>
        </div>
        {switchState.status === "error" || resetState.status === "error" ? (
          <p className="w-full text-xs text-red-800 dark:text-red-200">{switchState.status === "error" ? switchState.message : resetState.status === "error" ? resetState.message : ""}</p>
        ) : null}
      </div>
      {tourOpen && steps.length ? (
        <div className="border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/40">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-semibold">
              <ChevronDownIcon className="size-3.5" aria-hidden /> Try this:
            </span>
            <ol className="flex flex-wrap gap-1.5">
              {steps.map((step, index) => (
                <li key={step.href + index}>
                  <a href={step.href} className={cn("inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-0.5 text-xs hover:bg-amber-100 dark:bg-transparent")}>
                    <span className="font-semibold tabular-nums">{index + 1}</span> {step.label}
                  </a>
                </li>
              ))}
            </ol>
            <button type="button" onClick={closeTour} aria-label="Close the tour" className="ml-auto rounded p-1 hover:bg-amber-100">
              <XIcon className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The /demo role cards with a plan chooser above them: the visitor picks
 * Starter, Growth or Pro, then a role. The plan is sent as a slug and looked
 * up among published plans on the server.
 */
export function DemoStarter({ plans, roles }: { plans: Array<{ slug: string; name: string; summary: string }>; roles: Array<{ role: string; label: string; who: string; can: string }> }) {
  const [plan, setPlan] = useState(plans.at(-1)?.slug ?? "");
  return (
    <div className="flex flex-col gap-6">
      {plans.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">1. Choose a plan to try</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {plans.map((row) => (
              <label key={row.slug} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm", plan === row.slug ? "border-primary bg-primary-soft/40 ring-primary ring-1" : "bg-card hover:bg-muted/50")}>
                <input type="radio" name="demo-plan" value={row.slug} checked={plan === row.slug} onChange={() => setPlan(row.slug)} className="mt-0.5 size-4" />
                <span>
                  <span className="block font-semibold">{row.name}</span>
                  <span className="text-muted-foreground block text-xs">{row.summary}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">You can switch plan at any time from the demo bar.</p>
        </fieldset>
      ) : null}
      <div>
        {plans.length ? <p className="mb-2 text-sm font-semibold">2. Choose who to be</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((row, index) => (
            <div key={row.role} className="bg-card flex flex-col gap-3 rounded-2xl border p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-semibold">{row.label}</h2>
                <p className="text-muted-foreground text-sm">{row.who}</p>
              </div>
              <p className="flex-1 text-sm">{row.can}</p>
              <StartDemoButton role={row.role} label={`Explore as ${row.label}`} primary={index === 0} plan={plan} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
