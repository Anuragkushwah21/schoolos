import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { MyPhotoCard } from "@/features/photos/my-photo-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { listMyChildren } from "@/server/parent/access";

export const metadata: Metadata = { title: "My profile" };

/**
 * What the school holds about this guardian, and who they are linked to.
 *
 * Read-only throughout. The name, phone and address on this record are the
 * school's record of them, and the links to their children are the school's to
 * make — a guardian editing either would let them attach themselves to a child.
 * Their sign-in email and password live under Account, which every role shares.
 */
export default async function ParentProfilePage() {
  const ctx = await requireTenant("PARENT");
  const { parent, children } = await listMyChildren(ctx);

  return (
    <>
      <PageHeader
        title={`${parent.firstName} ${parent.lastName}`}
        description={ctx.schoolName}
        actions={
          <Button asChild variant="outline">
            <Link href="/account">Account settings</Link>
          </Button>
        }
      />
      <MyPhotoCard ctx={ctx} name={`${parent.firstName} ${parent.lastName}`} className="mb-6 max-w-2xl" />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>
              Held by the school office. Ask them to correct anything that is wrong — this record is
              how the school reaches you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Name" value={`${parent.firstName} ${parent.lastName}`} />
              <Detail label="Sign-in email" value={ctx.user.email} />
              <Detail label="Record email" value={parent.email ?? "—"} />
              <Detail label="Phone" value={parent.phone} />
              <Detail label="Occupation" value={parent.occupation ?? "—"} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked children</CardTitle>
            <CardDescription>
              One sign-in covers every child linked to you. Only the school office can add or remove
              a link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {children.length ? (
              <ul className="divide-y">
                {children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{child.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {child.sectionLabel ?? "Not placed this session"}
                        {child.rollNumber ? ` · roll ${child.rollNumber}` : ""} ·{" "}
                        {child.admissionNumber}
                      </span>
                    </span>
                    <StatusBadge status={child.relationship} label={humanize(child.relationship)} />
                    {child.isPrimary ? (
                      <StatusBadge status="ACTIVE" label="Primary contact" tone="info" />
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/parent/children/${child.id}` as Route}>Open</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No children linked yet">
                Ask the school office to link your children to this account.
              </EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
