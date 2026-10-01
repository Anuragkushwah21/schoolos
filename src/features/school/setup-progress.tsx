import Link from "next/link";
import { CheckIcon, MinusIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SetupReport, SetupStep } from "@/server/academics/setup";
import { getT } from "@/server/i18n";

import { skipSetupStepAction } from "./setup-actions";

type T = Awaited<ReturnType<typeof getT>>;

/** One line saying where a step stands, from its own counts. */
export function stepSummary(t: T, step: SetupStep): string {
  const base = `setup.steps.${step.key}` as const;
  const vars = Object.fromEntries(Object.entries(step.counts).map(([k, v]) => [k, String(v)]));
  if (step.state === "done") return t(`${base}.done`, vars);
  // A per-section step with no running section is waiting on students, not undone.
  if (["classTeachers", "subjectTeachers", "timetable"].includes(step.key) && step.counts.total === 0) return t("setup.waiting");
  return t(`${base}.todo`, vars);
}

function StepIcon({ state }: { state: SetupStep["state"] }) {
  if (state === "done") return <CheckIcon className="size-4" style={{ color: "var(--viz-good)" }} aria-label="Done" />;
  if (state === "skipped") return <MinusIcon className="text-muted-foreground size-4" aria-label="Skipped" />;
  return <span className="border-muted-foreground/40 size-3 rounded-full border" aria-label="To do" />;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * The dashboard card for a school still being set up: progress, every step at
 * a glance, and one primary button to the next thing to do. Hidden once the
 * school is set up, so an established school never sees it.
 */
export async function SetupProgressCard({ report }: { report: SetupReport }) {
  if (report.complete) return null;
  const t = await getT();
  return (
    <Card className="mb-6">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("setup.title")}</CardTitle>
          <span className="text-sm font-medium tabular-nums">{t("setup.progress", { percent: String(report.percent) })}</span>
        </div>
        <ProgressBar percent={report.percent} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {report.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center">
                <StepIcon state={step.state} />
              </span>
              <span className={step.state === "todo" ? "font-medium" : "text-muted-foreground"}>{t(`setup.steps.${step.key}.title`)}</span>
            </li>
          ))}
        </ul>
        {report.next ? (
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">{t(`setup.steps.${report.next.key}.title`)}:</span> {stepSummary(t, report.next)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {report.next ? (
            <Button asChild>
              <Link href={report.next.href}>{t("setup.continue")}</Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/school-admin/setup">{t("setup.viewAll")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The full list, with a button and — for optional steps — "Skip for now". */
export async function SetupStepList({ report }: { report: SetupReport }) {
  const t = await getT();
  return (
    <ol className="divide-y rounded-xl border">
      {report.steps.map((step) => {
        const isNext = report.next?.key === step.key;
        return (
          <li key={step.key} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${isNext ? "bg-muted/50" : ""}`}>
            <span className="flex size-5 shrink-0 items-center justify-center">
              <StepIcon state={step.state} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t(`setup.steps.${step.key}.title`)}
                {step.optional ? <span className="text-muted-foreground text-xs font-normal">· {t("setup.optional")}</span> : null}
              </span>
              <span className="text-muted-foreground block text-xs">
                {step.state === "skipped" ? t("setup.skipped") : stepSummary(t, step)}
              </span>
            </span>
            {step.state !== "done" ? (
              <span className="flex flex-wrap gap-2">
                {step.optional ? (
                  <ActionButton action={skipSetupStepAction} fields={{ step: step.key, skip: step.state === "skipped" ? "false" : "true" }} variant="ghost" size="sm">
                    {step.state === "skipped" ? t("setup.unskip") : t("setup.skip")}
                  </ActionButton>
                ) : null}
                <Button asChild size="sm" variant={isNext ? "default" : "outline"}>
                  <Link href={step.href}>{isNext ? t("setup.continue") : t(`setup.steps.${step.key}.title`)}</Link>
                </Button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export { ProgressBar };
