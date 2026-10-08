"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ExternalLinkIcon, TriangleAlertIcon, UserPlusIcon, XIcon } from "lucide-react";

import { useFormContext } from "@/components/forms/action-form";
import { SubmitButton } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatDate, parseDateInput } from "@/lib/dates";
import { DUPLICATE_FIELD, decodeMatches } from "@/lib/student-duplicates";

/**
 * "This child may already be at the school": shown inside an admission form
 * when the server finds students with the same name. Each match is listed with
 * what tells children apart — admission number, class, date of birth, parents
 * — and why it matched. The office then decides:
 *
 *   * "Add as a new student" resubmits the form with `confirmDuplicate`, and
 *     the admission is recorded as confirmed on the audit log;
 *   * "Don't add" leaves without adding anyone.
 */
export function DuplicateStudentWarning({ cancelHref }: { cancelHref: Route }) {
  const { fieldErrors } = useFormContext();
  const matches = decodeMatches(fieldErrors?.[DUPLICATE_FIELD]);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matches.length) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [fieldErrors, matches.length]);

  if (!matches.length) return null;
  const likely = matches.some((match) => match.likely);

  return (
    <div ref={panel} role="alert" className="border-warning bg-warning-soft scroll-mt-24 flex flex-col gap-4 rounded-2xl border-2 p-4">
      <div className="flex items-start gap-3">
        <span className="bg-warning flex size-10 shrink-0 items-center justify-center rounded-xl text-white">
          <TriangleAlertIcon className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-base font-bold">{likely ? "This child is probably already at the school" : "A student with the same name is already at the school"}</p>
          <p className="text-muted-foreground text-sm">
            {matches.length === 1 ? "Check this student before adding. Nothing has been saved yet." : "Check these students before adding. Nothing has been saved yet."}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {matches.map((match) => {
          const born = match.dateOfBirth ? parseDateInput(match.dateOfBirth) : null;
          return (
            <li key={match.id} className="bg-card rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/school-admin/students/${match.id}` as Route} target="_blank" className="text-primary inline-flex items-center gap-1 font-semibold hover:underline">
                  {match.name}
                  <ExternalLinkIcon className="size-3.5" aria-hidden />
                </Link>
                <span className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs">{match.admissionNumber}</span>
                {match.likely ? <span className="bg-destructive rounded-full px-2 py-0.5 text-xs font-semibold text-white">Very likely the same child</span> : null}
              </div>
              <p className="text-muted-foreground mt-1">
                {[match.group ?? "Not in a class this session", match.status, born ? `Born ${formatDate(born)}` : "Date of birth not recorded"].join(" · ")}
              </p>
              {match.parents.length ? <p className="text-muted-foreground">Parent: {match.parents.join(", ")}</p> : null}
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Why it matched">
                {match.reasons.map((reason) => (
                  <li key={reason} className={reason.startsWith("different") ? "bg-muted rounded-full px-2 py-0.5 text-xs" : "bg-warning/20 rounded-full px-2 py-0.5 text-xs font-medium"}>
                    {reason}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Is the child you are adding a different person?</p>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="confirmDuplicate" value="on" pendingLabel="Adding…" className="bg-success hover:bg-success/90 bg-none text-white shadow-none">
            <UserPlusIcon aria-hidden />
            Yes, different child — add as a new student
          </SubmitButton>
          <Button asChild className="bg-destructive hover:bg-destructive/90 bg-none text-white shadow-none">
            <Link href={cancelHref}>
              <XIcon aria-hidden />
              No, same child — don&apos;t add
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
