import { UserRoundCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeRegisterCoverAction, removeWorkCoverAction } from "@/features/attendance/cover-actions";
import { RegisterCoverForm, WorkCoverForm } from "@/features/attendance/cover-forms";
import { formatDayShort, parseDateInput, toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import { registerCoverBoard, workCoverBoard } from "@/server/attendance/cover";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Who covers today" };

const PHASE_LABEL = { NOT_TAKEN: "Not taken", DRAFT: "Draft", CORRECTABLE: "Submitted", LOCKED: "Submitted" } as const;
const PHASE_TONE = { NOT_TAKEN: "warning", DRAFT: "info", CORRECTABLE: "positive", LOCKED: "positive" } as const;

/**
 * When someone is away, give their daily work to someone else for the day:
 * a class's register to any teacher, a staff member's work to a colleague.
 * Whoever is assigned sees it on their own dashboard.
 */
export default async function CoverPage(props: PageProps<"/school-admin/attendance/cover">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const date = parseDateInput(param(search.date)) ?? today();
  const iso = toDateInput(date);
  const [registers, work] = await Promise.all([registerCoverBoard(ctx, date), workCoverBoard(ctx, date)]);

  // Sections whose class teacher is away, or who have none, come first.
  const needs = registers.sections.filter((s) => (s.classTeacherAway || !s.classTeacher) && !s.cover && s.phase === "NOT_TAKEN");
  const teacherOptions = (suggested: string[], exclude?: string) =>
    [...registers.teachers]
      .filter((t) => t.id !== exclude && !t.away)
      .sort((a, b) => Number(suggested.includes(b.id)) - Number(suggested.includes(a.id)) || a.name.localeCompare(b.name))
      .map((t) => ({ value: t.id, label: `${t.name}${suggested.includes(t.id) ? " · teaches this class" : ""}` }));
  const awayStaff = work.staff.filter((s) => s.away);

  return (
    <>
      <PageHeader
        icon={UserRoundCheckIcon}
        tone="purple"
        back={{ href: "/school-admin/attendance", label: "Attendance" }}
        title="Who covers today"
        description={`${formatDayShort(date)} · give an absent person's daily work to someone else. They see it on their dashboard.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/school-admin/attendance/history">History</Link>
          </Button>
        }
      />
      <FilterBar action="/school-admin/attendance/cover" dates={[{ name: "date", label: "Date", defaultValue: iso }]} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Class attendance</CardTitle>
          <CardDescription>
            {needs.length
              ? `${needs.length} class${needs.length === 1 ? " needs" : "es need"} someone to take attendance — the class teacher is away or not set.`
              : "Every class has someone to take attendance."}{" "}
            Any teacher can be given a class for the day: a substitute, or one who already teaches it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-xl border">
            {registers.sections.map((section) => {
              const attention = (section.classTeacherAway || !section.classTeacher) && !section.cover;
              return (
                <li key={section.id} className={`flex flex-col gap-3 p-4 ${attention ? "bg-warning-soft/40" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{section.label}</span>
                      <span className="text-muted-foreground block text-xs">
                        Class teacher: {section.classTeacher ? section.classTeacher.name : "not set"}
                        {section.classTeacherAway ? ` · ${section.classTeacherAway}` : ""}
                        {section.cover ? ` · covered by ${section.cover.name}${section.cover.reason ? ` (${section.cover.reason})` : ""}` : ""}
                      </span>
                    </span>
                    <StatusBadge status={section.phase} tone={PHASE_TONE[section.phase]} label={PHASE_LABEL[section.phase]} />
                    {section.cover ? (
                      <ActionButton action={removeRegisterCoverAction} fields={{ coverId: section.cover.id }} variant="ghost" size="xs">
                        Remove cover
                      </ActionButton>
                    ) : null}
                  </div>
                  {attention || section.cover ? (
                    <RegisterCoverForm
                      sectionId={section.id}
                      date={iso}
                      teachers={teacherOptions(section.suggested, section.classTeacher?.id)}
                      current={section.cover?.teacherId}
                    />
                  ) : (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer text-xs">Give this class to someone else today</summary>
                      <div className="mt-2">
                        <RegisterCoverForm sectionId={section.id} date={iso} teachers={teacherOptions(section.suggested, section.classTeacher?.id)} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Staff work</CardTitle>
            <CardDescription>
              {awayStaff.length ? `On leave today: ${awayStaff.map((s) => `${s.name} (${s.job})`).join(", ")}.` : "No staff on approved leave today."} Give their work to a colleague.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkCoverForm date={iso} staff={work.staff.map((s) => ({ value: s.id, label: `${s.name} · ${s.job}${s.away ? " · away" : ""}` }))} absentDefault={awayStaff[0]?.id} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Staff cover today</CardTitle>
          </CardHeader>
          <CardContent>
            {work.covers.length ? (
              <ul className="divide-y text-sm">
                {work.covers.map((cover) => (
                  <li key={cover.id} className="flex flex-wrap items-start gap-2 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">
                        {cover.cover.name} covers {cover.absent.name}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {cover.absent.job} · {cover.duties}
                      </span>
                    </span>
                    <ActionButton action={removeWorkCoverAction} fields={{ coverId: cover.id }} variant="ghost" size="xs">
                      Remove
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing assigned for this day.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
