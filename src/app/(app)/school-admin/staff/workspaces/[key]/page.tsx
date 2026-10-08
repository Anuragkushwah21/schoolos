import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";

import { NAV_ICONS } from "@/components/shared/nav-icons";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fullName } from "@/lib/format";
import { workspace } from "@/lib/staff-workspaces";
import type { StaffRole } from "@/generated/prisma/enums";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Workspace" };

/**
 * One role's workspace, for the School Admin: its modules, opened with the
 * admin's own full access (the admin is never switched into the role), and
 * the people in the role, if any.
 */
export default async function StaffWorkspacePage(props: PageProps<"/school-admin/staff/workspaces/[key]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { key } = await props.params;
  const space = workspace(key);
  if (!space) notFound();
  const Icon = NAV_ICONS[space.icon];
  const staffRoles = space.roles.filter((role) => role !== "TEACHER") as StaffRole[];
  const [people, teachers] = await Promise.all([
    staffRoles.length
      ? ctx.db.staffMember.findMany({
          where: { role: { in: staffRoles }, status: { in: ["ACTIVE", "ON_LEAVE"] } },
          orderBy: [{ firstName: "asc" }],
          take: 50,
          select: { id: true, firstName: true, lastName: true, status: true, roleProfile: { select: { name: true } } },
        })
      : [],
    space.roles.includes("TEACHER") ? ctx.db.teacher.count({ where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } }) : 0,
  ]);

  return (
    <>
      <PageHeader
        icon={Icon}
        tone="blue"
        back={{ href: "/school-admin/staff/workspaces" as Route, label: "Staff workspaces" }}
        title={`${space.title} workspace`}
        description={space.description}
        actions={
          <Button asChild variant="outline">
            <Link href={space.addHref}>
              <PlusIcon aria-hidden />
              Add {space.title.toLowerCase()}
            </Link>
          </Button>
        }
      />
      <p className="bg-primary-soft text-primary-strong mb-6 flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
        <ShieldCheckIcon className="size-4 shrink-0" aria-hidden />
        You work here as School Admin, with full access. Everything you do is recorded as done by you.
      </p>
      <div className="grid items-start gap-6 xl:grid-cols-[1.4fr_1fr]">
        <ul className="grid gap-3 sm:grid-cols-2">
          {space.links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="bg-card hover:border-primary/50 hover:bg-primary-soft flex h-full items-center gap-3 rounded-xl border p-4 transition-colors">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{link.label}</span>
                  <span className="text-muted-foreground block text-xs">{link.hint}</span>
                </span>
                <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        <Card>
          <CardHeader>
            <CardTitle>People in this role</CardTitle>
            <CardDescription>Each has only the permissions you give them. You keep full access either way.</CardDescription>
          </CardHeader>
          <CardContent>
            {space.roles.includes("TEACHER") ? (
              <p className="text-sm">
                {teachers} current teacher{teachers === 1 ? "" : "s"} ·{" "}
                <Link href="/school-admin/teachers" className="text-primary underline-offset-4 hover:underline">
                  open the teachers list
                </Link>
              </p>
            ) : people.length ? (
              <ul className="divide-y text-sm">
                {people.map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/school-admin/staff/${person.id}` as Route} className="font-medium hover:underline">
                      {fullName(person)}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">{person.roleProfile?.name}</span>
                      <StatusBadge status={person.status} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No one yet — you can do this work yourself from the cards, or add someone when you hire.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
