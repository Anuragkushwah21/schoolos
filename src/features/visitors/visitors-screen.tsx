import type { Route } from "next";
import { DoorOpenIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatSchoolTime, parseDateInput, toDateInput, today } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { param } from "@/lib/search-params";
import type { TenantContext } from "@/server/auth/current-user";
import { listVisitors } from "@/server/operations/visitors";

import { markVisitorExitAction } from "./actions";
import { VisitorEditForm, VisitorEntryForm } from "./forms";

const STATUS = { INSIDE: { label: "Inside", tone: "warning" }, LEFT: { label: "Left", tone: "positive" }, DENIED: { label: "Turned away", tone: "negative" } } as const;

/**
 * The visitor log at the gate — the School Admin's and security's one screen.
 * `canManage` shows the entry form, Mark out and corrections; the services
 * check the same permissions again.
 */
export async function VisitorsScreen({ ctx, search, base, canManage }: { ctx: TenantContext; search: Record<string, string | string[] | undefined>; base: Route; canManage: boolean }) {
  const date = parseDateInput(param(search.date)) ?? today();
  const q = param(search.q) ?? null;
  const log = await listVisitors(ctx, { date, q });

  return (
    <>
      <PageHeader icon={DoorOpenIcon} tone="cyan" title="Visitors" description="Who came in, whom they met, and when they left. Entries and corrections are kept on the audit log." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Inside now" value={log.inside} />
        <StatCard label="Visitors today" value={log.today} />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <div>
          <FilterBar action={base} search={{ name: "q", defaultValue: q ?? undefined, placeholder: "Name, mobile, person to meet or vehicle" }} dates={[{ name: "date", label: "Day", defaultValue: toDateInput(date) }]} />
          <Card>
            <CardHeader>
              <CardTitle>{q ? `Search: ${q}` : `${formatDate(date)}`}</CardTitle>
              <CardDescription>{q ? "Every visit that matches." : "That day's visitors, and anyone from earlier still marked inside."}</CardDescription>
            </CardHeader>
            <CardContent>
              {log.rows.length ? (
                <ul className="divide-y">
                  {log.rows.map((visitor) => (
                    <li key={visitor.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{visitor.name}</span>
                        <span className="text-muted-foreground text-sm">{visitor.phone}</span>
                        <StatusBadge status={visitor.status} label={STATUS[visitor.status].label} tone={STATUS[visitor.status].tone} />
                        {canManage && visitor.status === "INSIDE" ? (
                          <ActionButton action={markVisitorExitAction} fields={{ visitorId: visitor.id }} variant="outline">
                            Mark out
                          </ActionButton>
                        ) : null}
                      </div>
                      <p className="text-sm">
                        To meet <strong>{visitor.personToMeet}</strong> · {visitor.purpose}
                        {visitor.vehicleNo ? ` · ${visitor.vehicleNo}` : ""}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        In {formatDate(visitor.entryAt)} {formatSchoolTime(visitor.entryAt)}
                        {visitor.exitAt && visitor.status === "LEFT" ? ` · out ${formatSchoolTime(visitor.exitAt)}` : ""}
                        {visitor.recordedBy ? ` · logged by ${fullName(visitor.recordedBy)}` : ""}
                        {visitor.notes ? ` · ${visitor.notes}` : ""}
                      </p>
                      {canManage ? (
                        <details className="rounded-lg border p-3">
                          <summary className="cursor-pointer text-xs font-medium">Correct this visit</summary>
                          <div className="mt-3">
                            <VisitorEditForm
                              visitor={{
                                id: visitor.id,
                                name: visitor.name,
                                phone: visitor.phone,
                                purpose: visitor.purpose,
                                personToMeet: visitor.personToMeet,
                                vehicleNo: visitor.vehicleNo,
                                notes: visitor.notes,
                                status: visitor.status,
                              }}
                            />
                          </div>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No visitors recorded.</p>
              )}
            </CardContent>
          </Card>
        </div>
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Log a visitor</CardTitle>
            </CardHeader>
            <CardContent>
              <VisitorEntryForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
