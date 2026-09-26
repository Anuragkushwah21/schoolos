"use client";

import type { Route } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { humanize, pluralize } from "@/lib/format";

/**
 * "How many children does this family have here?" — answered in one click.
 *
 * The data is passed in from a server component that already read it under a
 * School Admin guard; this component fetches nothing and decides nothing. It
 * exists because a parent's children are the one thing a student-first list
 * cannot show: three siblings look like three unrelated rows with a repeated
 * name.
 */
export type ParentDialogChild = {
  id: string;
  name: string;
  admissionNumber: string;
  status: string;
  relationship: string;
  isPrimary: boolean;
  sectionLabel: string | null;
  rollNumber: string | null;
};

export type ParentDialogData = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  hasLogin: boolean;
  loginActive: boolean;
  children: ParentDialogChild[];
};

export function ParentDetailsDialog({
  parent,
  trigger,
}: {
  parent: ParentDialogData;
  /** What opens it — usually the parent's name in a table cell. */
  trigger?: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <button type="button" className="text-left text-sm font-medium hover:underline">
            {parent.name}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{parent.name}</DialogTitle>
          <DialogDescription>
            {parent.phone}
            {parent.email ? ` · ${parent.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {parent.hasLogin ? (
              <StatusBadge
                status={parent.loginActive ? "ACTIVE" : "INACTIVE"}
                label={parent.loginActive ? "Has a login" : "Login disabled"}
              />
            ) : (
              <StatusBadge status="PENDING" label="No login yet" />
            )}
            <span className="text-muted-foreground text-xs">
              {pluralize(parent.children.length, "child", "children")} at this school
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Children</h3>
            {parent.children.length ? (
              <ul className="divide-y rounded-lg border">
                {parent.children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{child.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {child.sectionLabel ?? "Not placed this session"}
                        {child.rollNumber ? ` · roll ${child.rollNumber}` : ""} ·{" "}
                        {child.admissionNumber}
                      </span>
                    </span>
                    <StatusBadge status={child.relationship} label={humanize(child.relationship)} />
                    {child.isPrimary ? (
                      <StatusBadge status="ACTIVE" label="Primary" tone="info" />
                    ) : null}
                    <Button asChild variant="ghost" size="xs">
                      <Link href={`/school-admin/students/${child.id}` as Route}>Open</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No children linked — which usually means a link was removed.
              </p>
            )}
          </div>

          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={`/school-admin/parents?q=${encodeURIComponent(parent.phone)}` as Route}>
              Open in parents
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
