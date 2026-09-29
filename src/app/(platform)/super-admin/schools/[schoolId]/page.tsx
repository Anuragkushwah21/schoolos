import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  markEmailVerifiedAction,
  resendSchoolCodeAction,
  setAdminActiveAction,
  simpleTransitionAction,
} from "@/features/platform/actions";
import {
  ApproveSchoolForm,
  CreateAdminForm,
  ReasonForm,
  ResetPasswordForm,
  SubscriptionForm,
} from "@/features/platform/forms";
import { formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { SUBSCRIPTION_STATUSES } from "@/lib/validation/platform";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { NotFoundError } from "@/lib/errors";
import { getSchoolForPlatform, listPlansForSelect } from "@/server/platform/schools";

export const metadata: Metadata = { title: "School" };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children || "—"}</dd>
    </div>
  );
}

export default async function PlatformSchoolPage(
  props: PageProps<"/super-admin/schools/[schoolId]">,
) {
  const user = await requireSuperAdmin();
  const { schoolId } = await props.params;

  const data = await getSchoolForPlatform(user, schoolId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const plans = await listPlansForSelect();
  const { school, admins, recentAudit } = data;
  const subscription = school.subscriptions[0];

  const awaitingReview = school.status === "PENDING" || school.status === "UNDER_REVIEW";

  return (
    <>
      <PageHeader
        back={{ href: "/super-admin/schools", label: "Schools" }}
        title={school.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={school.status} />
            {school.contactEmailVerifiedAt ? null : (
              <StatusBadge status="PENDING" label="Email not verified" />
            )}
            <span>Registered {formatDateTime(school.createdAt)}</span>
          </span>
        }
        actions={
          school.status === "ACTIVE" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/schools/${school.slug}`} target="_blank">
                View public site
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* ---------------- email verification ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Contact email</CardTitle>
              <CardDescription>
                {school.contactEmailVerifiedAt
                  ? `${school.contactEmail} verified ${formatDateTime(school.contactEmailVerifiedAt)}.`
                  : `${school.contactEmail} has not been verified. A school cannot be approved until the contact proves they can read this inbox.`}
              </CardDescription>
            </CardHeader>
            {school.contactEmailVerifiedAt ? null : (
              <CardContent className="flex flex-wrap items-start gap-2">
                <ActionButton
                  action={resendSchoolCodeAction}
                  fields={{ schoolId: school.id }}
                  variant="outline"
                >
                  Send the code again
                </ActionButton>
                <ActionButton
                  action={markEmailVerifiedAction}
                  fields={{ schoolId: school.id }}
                  variant="outline"
                  confirm={{
                    title: "Mark this email as verified?",
                    description:
                      "Only do this when you have confirmed the address another way — by phone, or on the school's letterhead. The override is recorded in the audit log with your name.",
                    confirmLabel: "Mark verified",
                  }}
                >
                  Mark verified
                </ActionButton>
              </CardContent>
            )}
          </Card>

          {/* ---------------- status actions ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                {awaitingReview && "This school is waiting for a decision."}
                {school.status === "ACTIVE" && "The school is live. Its users can sign in."}
                {school.status === "SUSPENDED" &&
                  `Suspended${school.suspendedReason ? `: ${school.suspendedReason}` : "."} Nobody at this school can sign in.`}
                {school.status === "REJECTED" &&
                  `Rejected${school.rejectionReason ? `: ${school.rejectionReason}` : "."}`}
                {school.status === "INACTIVE" && "Inactive. Nobody at this school can sign in."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {school.status === "PENDING" ? (
                <ActionButton
                  action={simpleTransitionAction}
                  fields={{ schoolId: school.id, transition: "review" }}
                  variant="outline"
                  className="w-fit"
                >
                  Mark as under review
                </ActionButton>
              ) : null}

              {/* Always mounted: it carries the password issued on approval,
                  which is shown once and cannot be recovered. */}
              <ApproveSchoolForm
                schoolId={school.id}
                canApprove={
                  Boolean(school.contactEmailVerifiedAt) &&
                  (awaitingReview || school.status === "REJECTED")
                }
              />

              {(awaitingReview || school.status === "REJECTED") && !school.contactEmailVerifiedAt ? (
                <p className="text-muted-foreground text-sm">
                  Approval opens once the contact email is verified, above.
                </p>
              ) : null}

              {awaitingReview ? (
                <ReasonForm
                  schoolId={school.id}
                  transition="reject"
                  label="Reject registration"
                  hint="Recorded on the school and in the audit log."
                />
              ) : null}

              {school.status === "ACTIVE" ? (
                <ReasonForm
                  schoolId={school.id}
                  transition="suspend"
                  label="Suspend school"
                  hint="Everyone at the school is signed out immediately."
                />
              ) : null}

              {school.status === "SUSPENDED" || school.status === "INACTIVE" ? (
                <ActionButton
                  action={simpleTransitionAction}
                  fields={{ schoolId: school.id, transition: "reactivate" }}
                  className="w-fit"
                  confirm={{
                    title: "Reactivate this school?",
                    description: "Its users will be able to sign in again.",
                    confirmLabel: "Reactivate",
                  }}
                >
                  Reactivate school
                </ActionButton>
              ) : null}
            </CardContent>
          </Card>

          {/* ---------------- administrators ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Administrators</CardTitle>
              <CardDescription>
                School admins manage everything inside the school. Passwords are
                shown once when issued.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {admins.length ? (
                <ul className="divide-y rounded-lg border">
                  {admins.map((admin) => (
                    <li key={admin.id} className="flex flex-col gap-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">
                            {admin.firstName} {admin.lastName}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {admin.email} · last sign-in {formatDateTime(admin.lastLoginAt)}
                          </p>
                        </div>
                        {admin.isActive ? null : <StatusBadge status="INACTIVE" label="Deactivated" />}
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        <ResetPasswordForm userId={admin.id} />
                        <ActionButton
                          action={setAdminActiveAction}
                          fields={{ userId: admin.id, active: admin.isActive ? "false" : "true" }}
                          variant={admin.isActive ? "destructive" : "outline"}
                          confirm={
                            admin.isActive
                              ? {
                                  title: "Deactivate this administrator?",
                                  description: "They are signed out at once and cannot sign in again until reactivated.",
                                  confirmLabel: "Deactivate",
                                }
                              : undefined
                          }
                        >
                          {admin.isActive ? "Deactivate" : "Reactivate"}
                        </ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No administrator yet.</p>
              )}

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Add an administrator</p>
                <CreateAdminForm schoolId={school.id} />
              </div>
            </CardContent>
          </Card>

          {/* ---------------- subscription ---------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>
                {subscription
                  ? `${subscription.plan.name} · ${humanize(subscription.status)} · ${formatDate(subscription.startsAt)} – ${subscription.endsAt ? formatDate(subscription.endsAt) : "no end date"}`
                  : "No plan assigned yet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubscriptionForm
                schoolId={school.id}
                plans={plans.map((plan) => ({
                  value: plan.id,
                  label: plan.isActive ? plan.name : `${plan.name} (hidden)`,
                }))}
                statuses={SUBSCRIPTION_STATUSES.map((value) => ({ value, label: humanize(value) }))}
                defaults={{
                  planId: subscription?.plan.id,
                  status: subscription?.status,
                  startsAt: toDateInput(subscription?.startsAt ?? today()),
                  endsAt: subscription?.endsAt ? toDateInput(subscription.endsAt) : "",
                  notes: subscription?.notes ?? "",
                }}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Registration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <Detail label="Address">/schools/{school.slug}</Detail>
                <Detail label="Location">
                  {[school.city, school.state].filter(Boolean).join(", ")}
                </Detail>
                <Detail label="Board">{school.affiliationBoard}</Detail>
                <Detail label="Established">{school.establishedYear}</Detail>
                <Detail label="Contact">{school.contactName}</Detail>
                <Detail label="Email">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {school.contactEmail}
                    {school.contactEmailVerifiedAt ? (
                      <StatusBadge status="ACTIVE" label="Verified" />
                    ) : (
                      <StatusBadge status="PENDING" label="Not verified" />
                    )}
                  </span>
                </Detail>
                <Detail label="Phone">{school.contactPhone}</Detail>
                <Detail label="Reviewed">
                  {school.reviewedAt
                    ? `${formatDateTime(school.reviewedAt)}${school.reviewedBy ? ` by ${school.reviewedBy.firstName} ${school.reviewedBy.lastName}` : ""}`
                    : null}
                </Detail>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
              <CardDescription>
                Counts only — individual records stay private to the school.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                {[
                  { label: "Students", value: school._count.students },
                  { label: "Teachers", value: school._count.teachers },
                  { label: "Parents", value: school._count.parents },
                  { label: "Classes", value: school._count.classes },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border p-3">
                    <dt className="text-muted-foreground text-xs">{item.label}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Platform activity</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/super-admin/audit?schoolId=${school.id}`}>All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentAudit.length ? (
                <ul className="flex flex-col gap-3">
                  {recentAudit.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p>{entry.summary}</p>
                      <p className="text-muted-foreground text-xs">{formatDateTime(entry.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No activity yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
