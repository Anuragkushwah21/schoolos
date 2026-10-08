import type { Metadata, Route } from "next";
import Link from "next/link";
import { SigmaIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResultSchemeForm } from "@/features/exams/forms";
import { OUTCOME_LABEL } from "@/lib/grades";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { finalResultsForSection, getResultScheme } from "@/server/exams/final-results";
import { getCurrentSession } from "@/server/academics/structure";

export const metadata: Metadata = { title: "Final result" };

const TONE = { PASS: "positive", FAIL: "negative", INCOMPLETE: "neutral" } as const;

/**
 * The session's final result: which exams count and how much, and each class's
 * weighted results. Families see a student's final result only once every
 * component exam is published.
 */
export default async function FinalResultPage(props: PageProps<"/school-admin/exams/final">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const sectionId = param(search.section);
  const [{ session, scheme, examNames }, current] = await Promise.all([getResultScheme(ctx), getCurrentSession(ctx)]);
  const sections = current
    ? await ctx.db.section.findMany({ where: { academicSessionId: current.id }, orderBy: [{ class: { level: "asc" } }, { name: "asc" }], select: { id: true, name: true, class: { select: { name: true } } } })
    : [];
  const table = sectionId && scheme ? await finalResultsForSection(ctx, sectionId) : null;

  return (
    <>
      <PageHeader icon={SigmaIcon} tone="purple" title="Final result" description={`${session.name} · each subject's final percentage is the weighted average of its exam percentages (Absent counts 0%, Exempt is left out). Grades and pass/fail follow your grading rules.`} />
      <div className="grid items-start gap-6 xl:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Exams and weights</CardTitle>
            <CardDescription>{examNames.length ? `Exams this session: ${examNames.join(", ")}` : "Create the session's exams first."}</CardDescription>
          </CardHeader>
          <CardContent>
            <ResultSchemeForm name={scheme?.name ?? `Final result ${session.name}`} componentsText={scheme ? scheme.components.map((row) => `${row.examName}: ${row.weight}`).join("\n") : examNames.map((name, index, all) => `${name}: ${index === all.length - 1 ? 100 - Math.floor(100 / all.length) * (all.length - 1) : Math.floor(100 / all.length)}`).join("\n")} />
          </CardContent>
        </Card>
        <div className="min-w-0">
          {scheme ? (
            <>
              <FilterBar action={"/school-admin/exams/final" as Route} selects={[{ name: "section", label: "Class", defaultValue: sectionId ?? undefined, allLabel: "Choose a class", options: sections.map((row) => ({ value: row.id, label: `${row.class.name} – ${row.name}` })) }]} />
              {table ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{`${scheme.name} · ${table.section.label}`}</CardTitle>
                    <CardDescription>{scheme.components.map((row) => `${row.examName} ${row.weight}%`).join(" + ")}</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr>
                          <th className="py-2 pr-3 text-left font-medium">Student</th>
                          {table.rows[0]?.subjects.map((subject) => (
                            <th key={subject.subject} className="py-2 pr-3 text-right font-medium">
                              {subject.subject}
                            </th>
                          ))}
                          <th className="py-2 pr-3 text-right font-medium">Overall</th>
                          <th className="py-2 pr-3 text-left font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {table.rows.map((row) => (
                          <tr key={row.studentId}>
                            <td className="py-2 pr-3 font-medium">{row.name}</td>
                            {row.subjects.map((subject) => (
                              <td key={subject.subject} className={`py-2 pr-3 text-right tabular-nums ${subject.passed === false ? "text-danger-strong font-semibold" : ""}`}>
                                {subject.percent === null ? "—" : `${subject.percent}% ${subject.grade ?? ""}`}
                              </td>
                            ))}
                            <td className="py-2 pr-3 text-right font-semibold tabular-nums">{row.percent === null ? "—" : `${row.percent}% ${row.grade ?? ""}`}</td>
                            <td className="py-2 pr-3">
                              <StatusBadge status={row.outcome} label={row.complete ? OUTCOME_LABEL[row.outcome] : `Waiting: ${row.missing.join(", ")}`} tone={TONE[row.outcome]} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {table.rows.length ? null : <p className="text-muted-foreground text-sm">No students in this class.</p>}
                  </CardContent>
                </Card>
              ) : (
                <p className="text-muted-foreground text-sm">Choose a class to see its final results.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Set which exams count and their weights. <Link className="text-primary hover:underline" href={"/school-admin/exams/term" as Route}>See term exams</Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
