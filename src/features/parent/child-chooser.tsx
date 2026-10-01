import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import type { AccentTone } from "@/components/shared/tones";
import { Card, CardContent } from "@/components/ui/card";
import type { TenantContext } from "@/server/auth/current-user";
import { listMyChildren } from "@/server/parent/access";

/**
 * A sidebar entry like Attendance or Results for a guardian: with one child
 * it opens that child's page; with several it asks which child. The child's
 * page itself re-checks the link to this guardian.
 */
export async function ChildChooser({
  ctx,
  section,
  title,
  description,
  icon,
  tone,
}: {
  ctx: TenantContext;
  /** The child sub-page: "attendance", "homework", "results". */
  section: "attendance" | "homework" | "results";
  title: string;
  description: string;
  icon: LucideIcon;
  tone: AccentTone;
}) {
  const { children } = await listMyChildren(ctx);
  const current = children.filter((child) => child.current);
  if (current.length === 1) redirect(`/parent/children/${current[0]!.id}/${section}` as Route);

  return (
    <>
      <PageHeader icon={icon} tone={tone} title={title} description={description} />
      {current.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {current.map((child) => (
            <Link key={child.id} href={`/parent/children/${child.id}/${section}` as Route} className="group rounded-2xl">
              <Card className="group-hover:border-primary/40 group-hover:shadow-lift transition-[box-shadow,transform] group-hover:-translate-y-0.5">
                <CardContent className="flex items-center gap-3">
                  <PersonAvatar name={child.name} photoUrl={child.photoUrl} className="size-11" />
                  <span className="min-w-0">
                    <span className="block font-semibold">{child.name}</span>
                    <span className="text-muted-foreground block text-xs">{child.sectionLabel ?? "Not placed this session"}</span>
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No children linked yet">The school office links a guardian to their children.</EmptyState>
      )}
    </>
  );
}
