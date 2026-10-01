import type { Metadata, Route } from "next";
import Link from "next/link";
import { HeartHandshakeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LifecyclePanel } from "@/features/people/lifecycle-panel";
import { humanize } from "@/lib/format";
import { PersonPhoto } from "@/components/shared/person-photo";
import { requireTenant } from "@/server/auth/current-user";
import { photoUrlFor } from "@/server/people/photos";
import { orNotFound } from "@/server/page-helpers";
import { getParentWithChildren } from "@/server/people/parents";

export const metadata: Metadata = { title: "Parent" };

/**
 * One guardian: who they are, every child they have been linked to (current
 * and past — the link is history and is never removed because a child left),
 * their standing, and their login.
 */
export default async function ParentProfilePage(props: PageProps<"/school-admin/parents/[parentId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { parentId } = await props.params;
  const parent = await orNotFound(getParentWithChildren(ctx, parentId));

  const photoUrl = await photoUrlFor(ctx, { type: "PARENT", id: parent.id });

  return (
    <>
      <PageHeader
        icon={HeartHandshakeIcon}
        tone="blue"
        back={{ href: "/school-admin/parents", label: "Parents" }}
        title={parent.name}
        description={`${parent.phone}${parent.email ? ` · ${parent.email}` : ""}`}
      />
      <div className="mb-6">
        <PersonPhoto name={`${parent.firstName} ${parent.lastName}`} photoUrl={photoUrl} who="The parent" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Children</CardTitle>
            <CardDescription>
              The guardian stays active while any child is a current student. A child who has left stays listed here as history, and opens no
              current data in the parent portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parent.children.length ? (
              <ul className="divide-y">
                {parent.children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={`/school-admin/students/${child.id}` as Route} className="font-medium hover:underline">
                        {child.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {child.admissionNumber}
                        {child.sectionLabel ? ` · ${child.sectionLabel}` : ""} · {humanize(child.relationship)}
                      </span>
                    </span>
                    <StatusBadge status={child.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No children linked.</p>
            )}
          </CardContent>
        </Card>
        <LifecyclePanel ctx={ctx} person="PARENT" personId={parent.id} childStatuses={parent.children.map((child) => child.status)} />
      </div>
    </>
  );
}
