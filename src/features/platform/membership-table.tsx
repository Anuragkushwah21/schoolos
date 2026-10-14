"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";

import { sendMembershipRemindersAction } from "./actions";

export type MembershipTableRow = {
  key: string;
  title: string;
  href: string;
  detail: string;
  status: "ACTIVE" | "TRIALING" | "PAST_DUE";
  /** The campus a reminder is sent for (its organization gets one email). */
  schoolId: string;
  endsOn: Date | null;
  daysLeft: number | null;
  lastRemindedAt: Date | null;
  /** Whether the latest reminder's email was delivered (null: never reminded). */
  lastReminderDelivered: boolean | null;
};

function DaysLeft({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days < 0) return <StatusBadge status="ENDED" label={days === -1 ? "Ended yesterday" : `Ended ${-days} days ago`} tone="negative" />;
  if (days === 0) return <StatusBadge status="TODAY" label="Ends today" tone="negative" />;
  return <StatusBadge status="LEFT" label={days === 1 ? "1 day" : `${days} days`} tone={days <= 7 ? "negative" : days <= 30 ? "warning" : "neutral"} />;
}

/**
 * Memberships with a reminder for one school (the row's button) or many (tick
 * rows, then "Send reminder to selected"). Every send asks for confirmation;
 * the server sends one email per organization and skips any reminded in the
 * last 24 hours.
 */
export function MembershipTable({ rows }: { rows: MembershipTableRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const all = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string, on: boolean) => setSelected((list) => (on ? [...list, id] : list.filter((row) => row !== id)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">{selected.length ? `${selected.length} selected` : "Tick schools to remind several at once."}</p>
        <div className="flex flex-wrap gap-2">
          {selected.length ? (
            <button type="button" className="text-muted-foreground text-sm underline" onClick={() => setSelected([])}>
              Clear selection
            </button>
          ) : null}
          <ActionButton
            action={sendMembershipRemindersAction}
            fields={{ schoolIds: selected }}
            disabled={!selected.length}
            size="sm"
            pendingLabel="Sending…"
            confirm={{
              title: `Send a membership reminder to the selected schools (${selected.length})?`,
              description: "Each organization's owner (or School Admin) gets one email saying their plan or trial is ending, has ended or has a payment due, and a notice in SchoolOS. Nothing is charged and no subscription changes. Anyone reminded in the last 24 hours is skipped.",
              confirmLabel: "Send reminders",
            }}
          >
            Send reminder to selected
          </ActionButton>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input type="checkbox" className="size-4" aria-label="Select all" checked={all} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.schoolId) : [])} />
              </TableHead>
              <TableHead>Organization / school</TableHead>
              <TableHead className="hidden md:table-cell">Plan</TableHead>
              <TableHead>Membership</TableHead>
              <TableHead>Ends</TableHead>
              <TableHead className="text-right">Days left</TableHead>
              <TableHead className="hidden lg:table-cell">Last reminded</TableHead>
              <TableHead className="text-right">Reminder</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <input type="checkbox" className="size-4" aria-label={`Select ${row.title}`} checked={selected.includes(row.schoolId)} onChange={(event) => toggle(row.schoolId, event.target.checked)} />
                </TableCell>
                <TableCell>
                  <Link href={row.href as never} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  <p className="text-muted-foreground text-xs md:hidden">{row.detail}</p>
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">{row.detail}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} label={row.status === "TRIALING" ? "Trial" : row.status === "PAST_DUE" ? "Payment overdue" : "Active"} tone={row.status === "PAST_DUE" ? "negative" : row.status === "TRIALING" ? "info" : "positive"} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.endsOn ? formatDate(row.endsOn) : <span className="text-muted-foreground">No end date</span>}</TableCell>
                <TableCell className="text-right">
                  <DaysLeft days={row.daysLeft} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{row.lastRemindedAt ? (row.lastReminderDelivered ? formatDateTime(row.lastRemindedAt) : `${formatDateTime(row.lastRemindedAt)} · not delivered`) : "Never"}</TableCell>
                <TableCell className="text-right">
                  <ActionButton
                    action={sendMembershipRemindersAction}
                    fields={{ schoolIds: [row.schoolId] }}
                    variant="outline"
                    size="xs"
                    pendingLabel="Sending…"
                    confirm={{ title: `Send a membership reminder to ${row.title}?`, description: "Their owner (or School Admin) gets an email and a notice in SchoolOS. Nothing is charged and the subscription does not change.", confirmLabel: "Send reminder" }}
                  >
                    Send reminder
                  </ActionButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
