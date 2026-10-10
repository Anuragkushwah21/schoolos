import type { Route } from "next";
import Link from "next/link";
import { InfoIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import type { AttentionRow } from "@/server/exams/attention";
import type { SignalRow } from "@/server/exams/student-signals";

/** The rule, in words, beside every Needs Attention list — nothing hidden. */
export function AttentionRule({ rule }: { rule: string }) {
  return (
    <p className="text-muted-foreground mb-4 flex items-start gap-2 text-sm">
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {rule} It is a prompt to help, not a label — it clears by itself when results improve.
    </p>
  );
}

/**
 * Students needing attention, one row per student and subject, each saying
 * why. "Start support" opens the support form for that student and subject.
 */
export function AttentionTable({
  rows,
  studentHref,
  supportBase,
  showSection = true,
}: {
  rows: AttentionRow[];
  studentHref: (row: AttentionRow) => string;
  supportBase: "/school-admin/support" | "/teacher/support";
  showSection?: boolean;
}) {
  return (
    <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            {showSection ? <TableHead>Class</TableHead> : null}
            <TableHead>Subject</TableHead>
            <TableHead>Latest test</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Support</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.studentId}-${row.subjectId}`}>
              <TableCell>
                <Link href={studentHref(row) as Route} className="font-medium hover:underline">
                  {row.student}
                </Link>
                <span className="text-muted-foreground block text-xs">{row.admissionNumber}</span>
              </TableCell>
              {showSection ? <TableCell>{row.section}</TableCell> : null}
              <TableCell>
                <span className="font-medium">{row.subject}</span>
                <span className="mt-1 block">
                  <StatusBadge status="NEEDS_ATTENTION" label="Needs attention" tone="warning" />
                </span>
              </TableCell>
              <TableCell className="tabular-nums">
                {row.latestPercent === null ? (
                  <span className="text-muted-foreground">No marks yet</span>
                ) : (
                  <>
                    <span className="font-semibold">{row.latestPercent}%</span>
                    <span className="text-muted-foreground block text-xs">
                      {row.latestTest} · {row.latestDate ? formatDate(row.latestDate) : ""}
                    </span>
                  </>
                )}
              </TableCell>
              <TableCell>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {row.reasons.map((reason) => (
                    <li key={reason.code}>{reason.text}</li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-right">
                {row.supportId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${supportBase}/${row.supportId}` as Route}>View support</Link>
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href={`${supportBase}/new?student=${row.studentId}&subject=${row.subjectId}` as Route}>Start support</Link>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Attendance and homework signals: one row per student, each reason in words. */
export function SignalTable({ rows, studentHref, supportBase }: { rows: SignalRow[]; studentHref: (row: SignalRow) => string; supportBase: "/school-admin/support" | "/teacher/support" }) {
  return (
    <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>What was seen</TableHead>
            <TableHead className="text-right">Support</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.studentId}>
              <TableCell>
                <Link href={studentHref(row) as Route} className="font-medium hover:underline">
                  {row.student}
                </Link>
                <span className="text-muted-foreground block text-xs">{row.admissionNumber}</span>
              </TableCell>
              <TableCell>{row.section}</TableCell>
              <TableCell>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {row.reasons.map((reason) => (
                    <li key={reason.code}>{reason.text}</li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-right">
                {row.supportId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`${supportBase}/${row.supportId}` as Route}>View support</Link>
                  </Button>
                ) : (
                  <Button asChild size="sm">
                    <Link href={`${supportBase}/new?student=${row.studentId}` as Route}>Start support</Link>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Class-wise counts: who each signal flags, and support open or resolved. */
export function AttentionByClassTable({ rows }: { rows: Array<{ sectionId: string; section: string; students: number; marks: number; attendance: number; homework: number; supportOpen: number; supportResolved: number }> }) {
  return (
    <div className="bg-card shadow-card overflow-x-auto rounded-2xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Class</TableHead>
            <TableHead className="text-right">Students</TableHead>
            <TableHead className="text-right">Marks</TableHead>
            <TableHead className="text-right">Attendance</TableHead>
            <TableHead className="text-right">Homework</TableHead>
            <TableHead className="text-right">Support open</TableHead>
            <TableHead className="text-right">Resolved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.sectionId}>
              <TableCell className="font-medium">{row.section}</TableCell>
              <TableCell className="text-right tabular-nums">{row.students}</TableCell>
              <TableCell className="text-right tabular-nums">{row.marks}</TableCell>
              <TableCell className="text-right tabular-nums">{row.attendance}</TableCell>
              <TableCell className="text-right tabular-nums">{row.homework}</TableCell>
              <TableCell className="text-right tabular-nums">{row.supportOpen}</TableCell>
              <TableCell className="text-right tabular-nums">{row.supportResolved}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
