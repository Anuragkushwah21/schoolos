import type { Metadata } from "next";
import { MessageSquarePlusIcon, MessagesSquareIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ParentConcernForm } from "@/features/concerns/forms";
import { ConcernCards } from "@/features/concerns/views";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { listConcerns, parentConcernOptions } from "@/server/support/concerns";

export const metadata: Metadata = { title: "My Concerns" };

/**
 * A parent's concerns about their children — theirs and the teachers' — and
 * the form to raise one. They choose a subject, never a teacher.
 */
export default async function ParentConcernsPage(props: PageProps<"/parent/concerns">) {
  const ctx = await requireTenant("PARENT");
  const search = await props.searchParams;
  const [t, rows, children] = await Promise.all([getT(), listConcerns(ctx, { status: "ALL" }), parentConcernOptions(ctx)]);

  return (
    <>
      <PageHeader icon={MessagesSquareIcon} tone="blue" title={t("concerns.parentTitle")} description={t("concerns.parentHint")} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <ConcernCards rows={rows} basePath="/parent/concerns" />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquarePlusIcon className="text-info size-5" aria-hidden />
              {t("concerns.raise")}
            </CardTitle>
            <CardDescription>{t("concerns.parentHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {children.length ? <ParentConcernForm childOptions={children} defaultChildId={param(search.child)} /> : <p className="text-muted-foreground text-sm">{t("concerns.noChildren")}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
