import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildSwitcher, ChildTabs } from "@/features/parent/child-nav";
import { FocusList, TodaysUpdate } from "@/features/parent/today";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";
import { childTransport } from "@/server/operations/transport";
import { formatDate } from "@/lib/dates";
import { childLoans } from "@/server/operations/library";
import { findChild, listMyChildren } from "@/server/parent/access";
import { getChildFocus, getChildToday } from "@/server/parent/child";

export const metadata: Metadata = { title: "Child" };

/**
 * One child's day, and the way into the rest of their record.
 *
 * The guardian link is checked in the database by `findChild`: being in the same
 * school is not enough to open another family's child, and an id that is not
 * linked answers exactly as one that does not exist.
 */
export default async function ParentChildPage(props: PageProps<"/parent/children/[studentId]">) {
  const ctx = await requireTenant("PARENT");
  const { studentId } = await props.params;

  const child = await orNotFound(findChild(ctx, studentId));

  if (!child.placement) {
    return (
      <>
        <PageHeader
          back={{ href: "/parent/dashboard", label: "Dashboard" }}
          title={child.student.name}
        />
        <EmptyState title="Not placed in a class this session">
          The school has not put {child.student.name.split(" ")[0]} in a section for the current
          academic year. Their day appears here once it does.
        </EmptyState>
      </>
    );
  }

  const [{ children }, today, focus, transport, loans] = await Promise.all([
    listMyChildren(ctx),
    orNotFound(getChildToday(ctx, studentId)),
    orNotFound(getChildFocus(ctx, studentId)),
    // After `findChild` above: only a linked child's transport is read.
    childTransport(ctx, child.student.id),
    // Also after `findChild`: only this linked child's books.
    childLoans(ctx, child.student.id),
  ]);

  const placed = children.filter((sibling) => sibling.sectionId !== null);

  return (
    <>
      <PageHeader
        back={{ href: "/parent/dashboard", label: "Dashboard" }}
        title={child.student.name}
        description={`${child.placement.sectionLabel}${child.placement.rollNumber ? `, roll ${child.placement.rollNumber}` : ""} · ${child.placement.sessionName} · ${child.student.admissionNumber}`}
      />

      <ChildSwitcher options={placed} activeId={studentId} tab="" />
      <ChildTabs studentId={studentId} active="" />

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <TodaysUpdate today={today} studentId={studentId} />

        <Card>
          <CardHeader>
            <CardTitle>What to help with at home</CardTitle>
            <CardDescription>
              Each line points at something a teacher recorded — a lesson, a mark or a due date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FocusList items={focus.items} />
          </CardContent>
        </Card>
      </div>

      {loans.length ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Library</CardTitle>
            <CardDescription>
              {loans.filter((loan) => !loan.returnedOn).length
                ? `${loans.filter((loan) => !loan.returnedOn).length} book(s) out now`
                : "No books out right now"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {loans.slice(0, 8).map((loan) => (
                <li key={loan.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{loan.book.title}</span>
                    {loan.copyCode ? <span className="bg-muted ml-2 rounded px-1.5 py-0.5 font-mono text-xs">{loan.copyCode}</span> : null}
                    <span className="text-muted-foreground block text-xs">
                      Issued {formatDate(loan.issuedOn)} · {loan.returnedOn ? `returned ${formatDate(loan.returnedOn)}` : `due ${formatDate(loan.dueOn)}`}
                    </span>
                  </span>
                  <StatusBadge
                    status={loan.status}
                    tone={loan.status === "OVERDUE" ? "negative" : loan.status === "RETURNED" ? "neutral" : "info"}
                    label={loan.status === "OVERDUE" ? "Overdue" : loan.status === "RETURNED" ? "Returned" : "Issued"}
                  />
                  {loan.fineMinor && !loan.finePaid ? <StatusBadge status="FINE" tone="warning" label="Fine due" /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {transport ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>School transport</CardTitle>
            <CardDescription>{transport.route}{transport.vehicle ? ` · ${transport.vehicle}` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground block text-xs">Stop</span>
              {transport.stop ?? "Not set"}
              {transport.pickup ? ` · pickup ${transport.pickup}` : ""}
              {transport.drop ? ` · drop ${transport.drop}` : ""}
            </p>
            <p>
              <span className="text-muted-foreground block text-xs">Driver</span>
              {transport.driver ? `${transport.driver.name}${transport.driver.phone ? ` · ${transport.driver.phone}` : ""}` : "—"}
            </p>
            <p>
              <span className="text-muted-foreground block text-xs">Attendant</span>
              {transport.attendant ? `${transport.attendant.name}${transport.attendant.phone ? ` · ${transport.attendant.phone}` : ""}` : "—"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
