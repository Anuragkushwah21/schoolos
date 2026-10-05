import type { Route } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import type { TestRow } from "@/server/exams/service";

const STAGE_TONE = { UPCOMING: "info", ENTER_MARKS: "warning", DRAFT: "warning", SUBMITTED: "info", PUBLISHED: "positive" } as const;

/**
 * Tests in one table, the same for teacher and School Admin: what it is, who
 * it is for, how far marking has got, and the one next step.
 */
export function TestsTable({ rows, hrefFor, showTeacher = false }: { rows: TestRow[]; hrefFor: (row: TestRow) => string; showTeacher?: boolean }) {
  return (
    <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Class</TableHead>
            {showTeacher ? <TableHead className="hidden lg:table-cell">Teacher</TableHead> : null}
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Marked</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const actionable = row.stage === "ENTER_MARKS" || row.stage === "DRAFT";
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={hrefFor(row) as Route} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                  <span className="text-muted-foreground block text-xs">
                    {row.kind === "EXAM" ? "Exam paper" : "Test"} · out of {row.maxMarks}
                  </span>
                </TableCell>
                <TableCell>{row.subject}</TableCell>
                <TableCell>
                  {row.section}
                  {row.stream ? <span className="text-muted-foreground block text-xs">{row.stream}</span> : null}
                </TableCell>
                {showTeacher ? <TableCell className="text-muted-foreground hidden lg:table-cell">{row.teacher ?? "—"}</TableCell> : null}
                <TableCell className="tabular-nums">{formatDate(row.date)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.entered}/{row.expected}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.stage} label={row.stageLabel} tone={STAGE_TONE[row.stage]} />
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant={actionable ? "default" : "outline"}>
                    <Link href={hrefFor(row) as Route}>{actionable ? "Enter marks" : "View"}</Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
