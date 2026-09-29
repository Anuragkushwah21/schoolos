import { ArrowUpRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromotionWorkbench } from "@/features/school/promotion-workbench";
import { formatDate } from "@/lib/dates";
import { pluralize } from "@/lib/format";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { promotionHistory, promotionSessions, promotionSourceClasses } from "@/server/academics/promotion";

export const metadata: Metadata = { title: "Student promotion" };

export default async function PromotionPage(props: PageProps<"/school-admin/academics/promotion">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;

  const { sessions, from, to, later } = await promotionSessions(ctx, { from: param(search.from), to: param(search.to) });
  const [classes, history] = await Promise.all([
    from ? promotionSourceClasses(ctx, from.id) : Promise.resolve([]),
    promotionHistory(ctx),
  ]);

  return (
    <>
      <PageHeader
        icon={ArrowUpRightIcon}
        tone="blue"
        back={{ href: "/school-admin/academics", label: "Academics" }}
        title="Student promotion"
        description="Move students up to next year's classes in one go. Last year's attendance, marks and fees stay exactly where they are."
      />

      {from ? (
        <FilterBar
          action="/school-admin/academics/promotion"
          selects={[
            {
              name: "from",
              label: "Promote from",
              defaultValue: from.id,
              options: sessions.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} (current)` : s.name })),
            },
            ...(to
              ? [
                  {
                    name: "to",
                    label: "Promote to",
                    defaultValue: to.id,
                    options: later.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} (current)` : s.name })),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {!from || !to ? (
        <Card>
          <CardHeader>
            <CardTitle>Create next year&apos;s session first</CardTitle>
            <CardDescription>
              {from
                ? `There is no session after ${from.name} to promote into.`
                : "Promotion needs two academic sessions: the one students are in, and the next one."}{" "}
              Add it under Academics — it does not have to be the current session yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/school-admin/academics">Go to Academics</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        // Keyed by the pair, so choosing other sessions starts a fresh plan.
        <PromotionWorkbench key={`${from.id}:${to.id}`} from={{ id: from.id, name: from.name }} to={{ id: to.id, name: to.name }} classes={classes} />
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Promotion history</CardTitle>
          <CardDescription>Every promotion is also in the school&apos;s activity log.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <ul className="divide-y rounded-lg border">
              {history.map((run) => (
                <li key={run.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {run.fromName && run.toName ? `${run.fromName} → ${run.toName}` : (run.toName ?? "Promotion")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {[
                        `${pluralize(run.promoted, "student")} promoted`,
                        run.repeated ? `${run.repeated} kept in the same class` : null,
                        run.graduated ? `${run.graduated} graduated` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatDate(run.at)}
                    {run.by ? ` · by ${run.by}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No promotions yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
