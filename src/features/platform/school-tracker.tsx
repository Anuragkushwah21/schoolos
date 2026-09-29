"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { MailIcon, MapPinIcon, PhoneIcon, UserIcon } from "lucide-react";

import { ActionForm } from "@/components/forms/action-form";
import { SubmitButton, TextField } from "@/components/forms/fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrackedSchool } from "@/server/analytics/platform";

import { setSchoolUdiseAction } from "./actions";

/**
 * Every school in one table; a row opens the school's owner and contact
 * details in a modal, where the UDISE code can also be filled in.
 *
 * Dates and money arrive already formatted by the server. Formatting them here
 * would use the browser's own locale data, which does not always match the
 * server's ("Sept" vs "Sep") and breaks hydration.
 */
export type TrackerRow = TrackedSchool & { joinedLabel: string; revenueLabel: string };

export function SchoolTracker({ rows }: { rows: TrackerRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((row) => row.id === openId) ?? null;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>UDISE code</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Established</TableHead>
              <TableHead className="text-right">Students</TableHead>
              <TableHead className="text-right">Teachers</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead>Location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => setOpenId(row.id)}
              >
                <TableCell>
                  <button
                    type="button"
                    className="text-left font-medium hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenId(row.id);
                    }}
                  >
                    {row.name}
                  </button>
                  {row.status !== "ACTIVE" ? (
                    <span className="ml-2">
                      <StatusBadge status={row.status} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums">{row.udiseCode ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{row.joinedLabel}</TableCell>
                <TableCell>{row.establishedYear ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.students}</TableCell>
                <TableCell className="text-right tabular-nums">{row.teachers}</TableCell>
                <TableCell className="text-right tabular-nums">{row.revenueLabel}</TableCell>
                <TableCell className="min-w-32">{row.location || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open !== null} onOpenChange={(value) => (value ? null : setOpenId(null))}>
        {open ? (
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{open.name}</DialogTitle>
              <DialogDescription>
                {open.location || "Location not given"}
                {open.plan ? ` · ${open.plan} plan` : ""}
              </DialogDescription>
            </DialogHeader>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">School owner / contact</h3>
              <ul className="flex flex-col gap-2 text-sm">
                <li className="flex items-center gap-2">
                  <UserIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  {open.owner.name}
                </li>
                <li className="flex items-center gap-2">
                  <PhoneIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <a href={`tel:${open.owner.phone.replace(/\s+/g, "")}`} className="text-primary hover:underline">
                    {open.owner.phone}
                  </a>
                </li>
                <li className="flex items-center gap-2">
                  <MailIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <a href={`mailto:${open.owner.email}`} className="text-primary break-all hover:underline">
                    {open.owner.email}
                  </a>
                </li>
                <li className="flex items-start gap-2">
                  <MapPinIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  {open.owner.address || open.location || "Address not given"}
                </li>
              </ul>
            </section>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Principal</dt>
              <dd>{open.owner.principal ?? "—"}</dd>
              <dt className="text-muted-foreground">School phone</dt>
              <dd>{open.owner.schoolPhone ?? "—"}</dd>
              <dt className="text-muted-foreground">School email</dt>
              <dd className="break-all">{open.owner.schoolEmail ?? "—"}</dd>
              <dt className="text-muted-foreground">Board</dt>
              <dd>{open.board ?? "—"}</dd>
              <dt className="text-muted-foreground">Joined</dt>
              <dd>{open.joinedLabel}</dd>
              <dt className="text-muted-foreground">Established</dt>
              <dd>{open.establishedYear ?? "—"}</dd>
              <dt className="text-muted-foreground">Students / teachers</dt>
              <dd>
                {open.students} / {open.teachers}
              </dd>
              <dt className="text-muted-foreground">Fees collected</dt>
              <dd>{open.revenueLabel}</dd>
            </dl>

            {open.owner.admins.length ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">School admin accounts</h3>
                <ul className="text-sm">
                  {open.owner.admins.map((admin) => (
                    <li key={admin.email} className="text-muted-foreground">
                      {admin.name} · {admin.email}
                      {admin.phone ? ` · ${admin.phone}` : ""}
                      {admin.isActive ? "" : " · deactivated"}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <ActionForm action={setSchoolUdiseAction} className="gap-3">
              <input type="hidden" name="schoolId" value={open.id} />
              <TextField
                key={open.id}
                name="udiseCode"
                label="UDISE code"
                inputMode="numeric"
                defaultValue={open.udiseCode ?? ""}
                placeholder="11 digits"
                hint="Leave empty to clear it."
              />
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                  Save UDISE code
                </SubmitButton>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/super-admin/schools/${open.id}` as Route}>Open full school page</Link>
                </Button>
              </div>
            </ActionForm>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
