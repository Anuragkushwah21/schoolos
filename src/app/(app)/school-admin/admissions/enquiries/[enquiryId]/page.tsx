import type { Metadata, Route } from "next";
import Link from "next/link";
import { BadgeIndianRupeeIcon, PencilIcon, UserCheckIcon, UsersRoundIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { linkParentAction, setChildWithdrawnAction } from "@/features/admissions/enquiry-actions";
import { ClassBadge, DiscountText, ENQUIRY_SOURCE_LABEL, ENQUIRY_STATUS_LABEL, FEE_STATUS_LABEL, FeeFigures, StreamBadge } from "@/features/admissions/enquiry-bits";
import { FamilySummary } from "@/features/admissions/enquiry-form";
import { ChildFeeForm, EnquiryFollowUpForm, EnquiryStatusForm, FamilyFeeForm } from "@/features/admissions/enquiry-panels";
import { rupees } from "@/features/finance/money";
import { formatDate, formatDateTime, today, toDateInput } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { enquiryAssignees, getEnquiry, parentMatches } from "@/server/admissions/enquiries";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Enquiry" };

type Match = Awaited<ReturnType<typeof parentMatches>>["byContact"][number];

function ExistingChildren({ match }: { match: Match }) {
  return match.children.length ? (
    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
      {match.children.map((child) => (
        <li key={child.name}>
          • {child.name}
          {child.className ? ` — ${child.className}` : ""}
          {child.streamName ? ` ${child.streamName}` : ""}
          {child.status !== "ACTIVE" ? ` (${humanize(child.status)})` : ""}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground text-sm">No children linked yet.</p>
  );
}

export default async function EnquiryPage(props: PageProps<"/school-admin/admissions/enquiries/[enquiryId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { enquiryId } = await props.params;
  const enquiry = await orNotFound(getEnquiry(ctx, enquiryId));
  const [matches, assignees] = await Promise.all([parentMatches(ctx, { phone: enquiry.phone, email: enquiry.email, parentName: enquiry.parentName }), enquiryAssignees(ctx)]);
  const base = `/school-admin/admissions/enquiries/${enquiry.id}`;
  const linked = enquiry.existingParent;
  const linkedMatch = linked ? [...matches.byContact, ...matches.byName].find((row) => row.id === linked.id) : null;
  const canEditFees = enquiry.status !== "CLOSED";
  const admittedToApply = enquiry.children.filter(
    (child) => child.status === "ADMITTED" && child.finalMinor !== null && !child.concessionAppliedAt && (child.discountMinor > 0 || enquiry.familyDiscountMinor > 0),
  );
  const activeChildren = enquiry.children.filter((child) => child.status !== "WITHDRAWN").length;

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/admissions/enquiries", label: "Walk-in admissions" }}
        icon={UsersRoundIcon}
        tone="purple"
        title={`${enquiry.parentName} — family enquiry`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={enquiry.status} label={ENQUIRY_STATUS_LABEL[enquiry.status]} />
            <StatusBadge status={enquiry.feeStatus} label={`Fee: ${FEE_STATUS_LABEL[enquiry.feeStatus]}`} />
            <span className="font-mono text-xs">{enquiry.enquiryNumber}</span>
            <span>
              · {ENQUIRY_SOURCE_LABEL[enquiry.source]} · {enquiry.children.length} {enquiry.children.length === 1 ? "child" : "children"} · received {formatDateTime(enquiry.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            {admittedToApply.length ? (
              <Button asChild>
                <Link href={`${base}/fees` as Route}>
                  <BadgeIndianRupeeIcon aria-hidden />
                  Apply agreed discount to fees
                </Link>
              </Button>
            ) : null}
            {enquiry.open ? (
              <Button asChild variant="outline">
                <Link href={`${base}/edit` as Route}>
                  <PencilIcon aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* Existing parent: link instead of creating a second parent. */}
          {linked ? (
            <Card className="border-success/40">
              <CardHeader>
                <CardTitle>Linked to existing parent</CardTitle>
                <CardDescription>
                  {fullName(linked)} · {linked.phone}. Children admitted from this enquiry join this parent — no second parent record.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {linkedMatch ? <ExistingChildren match={linkedMatch} /> : null}
                <div>
                  <ActionButton action={linkParentAction} fields={{ enquiryId: enquiry.id, parentId: "" }} variant="ghost" size="sm">
                    Unlink
                  </ActionButton>
                </div>
              </CardContent>
            </Card>
          ) : matches.byContact.length || matches.byName.length ? (
            <Card className="border-warning/50">
              <CardHeader>
                <CardTitle>Existing parent found</CardTitle>
                <CardDescription>Link them so this family is not created twice. Only parents of this school are searched.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {matches.byContact.map((match) => (
                  <div key={match.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3">
                    <div>
                      <p className="font-semibold">
                        {match.name} <span className="text-muted-foreground text-xs font-normal">· same {match.matchedBy} · {match.phone}</span>
                      </p>
                      <p className="text-muted-foreground text-xs">Existing children:</p>
                      <ExistingChildren match={match} />
                    </div>
                    <ActionButton action={linkParentAction} fields={{ enquiryId: enquiry.id, parentId: match.id }} size="sm">
                      Link existing parent
                    </ActionButton>
                  </div>
                ))}
                {matches.byName.map((match) => (
                  <div key={match.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-dashed p-3">
                    <div>
                      <p className="font-semibold">
                        {match.name} <span className="text-muted-foreground text-xs font-normal">· same name only · {match.phone}</span>
                      </p>
                      <ExistingChildren match={match} />
                    </div>
                    <ActionButton
                      action={linkParentAction}
                      fields={{ enquiryId: enquiry.id, parentId: match.id, confirmNameOnly: "true" }}
                      size="sm"
                      variant="outline"
                      confirm={{ title: `Link ${match.name}?`, description: "Only the name matches — the mobile and email are different. Link only if you are sure this is the same parent.", confirmLabel: "Yes, same parent" }}
                    >
                      Link after checking
                    </ActionButton>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Children, each with their own class, stream and fee discussion. */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Children</h2>
            {enquiry.children.map((child) => (
              <Card key={child.id} className={child.status === "WITHDRAWN" ? "opacity-70" : child.status === "ADMITTED" ? "border-success/40" : undefined}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {child.name}
                    <ClassBadge>{child.class.name}</ClassBadge>
                    <StreamBadge rule={child.streamRule} name={child.stream?.name} />
                    {child.status !== "OPEN" ? <StatusBadge status={child.status} label={child.status === "ADMITTED" ? "Admitted" : "Not proceeding"} /> : null}
                  </CardTitle>
                  <CardDescription>
                    {[child.dateOfBirth ? `Born ${formatDate(child.dateOfBirth)}` : null, child.gender ? humanize(child.gender) : null, child.previousSchool ? `From ${child.previousSchool}` : null, child.notes].filter(Boolean).join(" · ") || "No other details yet."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {child.feeOriginalMinor !== null && child.finalMinor !== null ? (
                    <>
                      <FeeFigures originalMinor={child.feeOriginalMinor} discount={<DiscountText kind={child.discountKind} value={child.discountValue} discountMinor={child.discountMinor} />} finalMinor={child.finalMinor} />
                      {child.discountReason || child.feeNotes ? (
                        <p className="text-muted-foreground text-xs">
                          {child.discountReason ? `Reason: ${child.discountReason}` : ""}
                          {child.discountReason && child.feeNotes ? " · " : ""}
                          {child.feeNotes}
                        </p>
                      ) : null}
                      {child.feeUpdatedAt ? (
                        <p className="text-muted-foreground text-xs">
                          Last changed {formatDateTime(child.feeUpdatedAt)}
                          {child.updatedBy ? ` by ${fullName(child.updatedBy)}` : ""}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">Fee not discussed yet.</p>
                  )}

                  {child.convertedStudent ? (
                    <p className="bg-success-soft/60 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
                      Admitted as{" "}
                      <Link href={`/school-admin/students/${child.convertedStudent.id}` as Route} className="font-semibold underline">
                        {fullName(child.convertedStudent)} ({child.convertedStudent.admissionNumber})
                      </Link>
                      {child.concessionAppliedAt ? ` · agreed discount applied to fees on ${formatDate(child.concessionAppliedAt)}` : child.finalMinor !== null ? " · agreed discount not yet applied to fees" : ""}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {child.status === "OPEN" && enquiry.status !== "CLOSED" ? (
                      <Button asChild size="sm">
                        <Link href={`${base}/convert/${child.id}` as Route}>
                          <UserCheckIcon aria-hidden />
                          Admit as student
                        </Link>
                      </Button>
                    ) : null}
                    {child.status !== "ADMITTED" && enquiry.status !== "CLOSED" ? (
                      <ActionButton
                        action={setChildWithdrawnAction}
                        fields={{ childId: child.id, withdrawn: child.status === "WITHDRAWN" ? "false" : "true" }}
                        size="sm"
                        variant="ghost"
                        confirm={child.status === "WITHDRAWN" ? undefined : { title: `${child.firstName} is not coming?`, description: "The child stays on the enquiry for the record, but leaves the family total.", confirmLabel: "Mark not proceeding" }}
                      >
                        {child.status === "WITHDRAWN" ? "Bring back" : "Not proceeding"}
                      </ActionButton>
                    ) : null}
                  </div>

                  {canEditFees && child.status !== "WITHDRAWN" && !child.concessionAppliedAt ? (
                    <details className="rounded-xl border p-3">
                      <summary className="cursor-pointer text-sm font-medium">{child.feeOriginalMinor !== null ? "Edit fee discussion" : "Add fee discussion"}</summary>
                      <div className="mt-4">
                        <ChildFeeForm childId={child.id} defaults={{ feeOriginalMinor: child.feeOriginalMinor, discountKind: child.discountKind, discountValue: child.discountValue, discountReason: child.discountReason, feeNotes: child.feeNotes }} />
                      </div>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </section>

          <Card className="ring-primary/20 ring-1">
            <CardHeader>
              <CardTitle>Family fee discussion</CardTitle>
              <CardDescription>
                A summary for the conversation with the family. Each child&apos;s future fees stay on their own account — this total is never an invoice.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {enquiry.totals.discussedChildren ? (
                <FamilySummary totals={enquiry.totals} count={activeChildren} />
              ) : (
                <p className="text-muted-foreground text-sm">No fees discussed yet. Add a fee discussion on a child above; the family total appears here.</p>
              )}
              {enquiry.familyDiscountMinor ? (
                <p className="text-sm">
                  Family / sibling discount: <strong>{rupees(enquiry.familyDiscountMinor)}</strong>
                  {enquiry.familyDiscountKind === "PERCENT" ? ` (${enquiry.familyDiscountValue / 100}%)` : ""}
                  {enquiry.familyDiscountReason ? ` — ${enquiry.familyDiscountReason}` : ""}
                </p>
              ) : null}
              {enquiry.discussionNotes ? (
                <p className="bg-muted/50 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                  <span className="text-muted-foreground block text-xs">Discussion notes (internal)</span>
                  {enquiry.discussionNotes}
                </p>
              ) : null}
              {enquiry.feeAgreedAt ? (
                <p className="text-success-strong text-sm">
                  Agreed {formatDateTime(enquiry.feeAgreedAt)}
                  {enquiry.feeAgreedBy ? ` by ${fullName(enquiry.feeAgreedBy)}` : ""}
                </p>
              ) : null}
              {canEditFees ? (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Family discount, notes and status</summary>
                  <div className="mt-4">
                    <FamilyFeeForm
                      enquiryId={enquiry.id}
                      subtotalMinor={enquiry.totals.subtotalMinor}
                      defaults={{ kind: enquiry.familyDiscountKind, value: enquiry.familyDiscountValue, reason: enquiry.familyDiscountReason, notes: enquiry.discussionNotes, status: enquiry.feeStatus }}
                    />
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {enquiry.feeRevisions.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Fee discussion history</CardTitle>
                <CardDescription>Every figure as it was discussed. Nothing is overwritten.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="divide-y text-sm">
                  {enquiry.feeRevisions.map((revision) => (
                    <li key={revision.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <span>
                        <strong>{revision.childName ?? "Family discount"}</strong>: {rupees(revision.originalMinor)} − {revision.discountKind === "PERCENT" ? `${revision.discountValue / 100}% ` : ""}
                        {rupees(revision.discountMinor)} = {rupees(revision.finalMinor)}
                        {revision.reason ? <span className="text-muted-foreground"> · {revision.reason}</span> : null}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(revision.createdAt)}
                        {revision.changedBy ? ` · ${fullName(revision.changedBy)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Parent / guardian</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>
                  {enquiry.parentName} ({humanize(enquiry.relationship)})
                </dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd>{enquiry.phone}</dd>
                {enquiry.alternatePhone ? (
                  <>
                    <dt className="text-muted-foreground">Alternate</dt>
                    <dd>{enquiry.alternatePhone}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{enquiry.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{[enquiry.addressLine, enquiry.city, enquiry.state, enquiry.postalCode].filter(Boolean).join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Session</dt>
                <dd>{enquiry.academicSession.name}</dd>
              </dl>
              {enquiry.notes ? <p className="bg-muted/50 mt-3 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">{enquiry.notes}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Follow-up</CardTitle>
              <CardDescription>
                {enquiry.nextFollowUpOn ? `Next: ${formatDate(enquiry.nextFollowUpOn)}${enquiry.nextAction ? ` — ${enquiry.nextAction}` : ""}` : "No follow-up set."}
                {enquiry.assignedTo ? ` · Assigned to ${fullName(enquiry.assignedTo)}` : ""}
                {enquiry.lastContactedAt ? ` · Last contacted ${formatDateTime(enquiry.lastContactedAt)}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <EnquiryFollowUpForm enquiryId={enquiry.id} today={toDateInput(today())} assignees={assignees} assignedToId={enquiry.assignedToId} />
              {enquiry.followUps.length ? (
                <ol className="divide-y border-t text-sm">
                  {enquiry.followUps.map((item) => (
                    <li key={item.id} className="py-2.5">
                      <p className="whitespace-pre-wrap">{item.note}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(item.createdAt)}
                        {item.author ? ` · ${fullName(item.author)}` : ""}
                        {item.nextFollowUpOn ? ` · next: ${formatDate(item.nextFollowUpOn)}` : ""}
                        {item.nextAction ? ` · ${item.nextAction}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </CardContent>
          </Card>

          {enquiry.status !== "CONVERTED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>
                  {enquiry.status === "CLOSED" ? `Closed ${enquiry.closedAt ? formatDate(enquiry.closedAt) : ""}${enquiry.closeReason ? ` — ${enquiry.closeReason}` : ""}.` : "Moves to Converted by itself once every child still coming is admitted."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EnquiryStatusForm enquiryId={enquiry.id} status={enquiry.status} />
              </CardContent>
            </Card>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Created {formatDateTime(enquiry.createdAt)}
            {enquiry.createdBy ? ` by ${fullName(enquiry.createdBy)}` : ""} · last updated {formatDateTime(enquiry.updatedAt)}
            {enquiry.updatedBy ? ` by ${fullName(enquiry.updatedBy)}` : ""}
          </p>
        </div>
      </div>
    </>
  );
}
