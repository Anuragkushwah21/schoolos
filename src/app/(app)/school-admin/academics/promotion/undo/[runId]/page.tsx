import type { Metadata } from "next";
import { Undo2Icon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromotionUndoForm } from "@/features/school/promotion-undo-form";
import { previewPromotionReversal } from "@/server/academics/promotion";
import { requireTenant } from "@/server/auth/current-user";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Undo promotion" };

/**
 * Undo a promotion run: preview who goes back and who must stay (anyone with
 * records in the new session), then confirm with a reason.
 */
export default async function UndoPromotionPage(props: PageProps<"/school-admin/academics/promotion/undo/[runId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { runId } = await props.params;
  const preview = await orNotFound(previewPromotionReversal(ctx, decodeURIComponent(runId)));

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/academics/promotion", label: "Student promotion" }}
        icon={Undo2Icon}
        tone="red"
        title="Undo promotion"
        description="Students go back to last session's class. Their new placement is removed only if nothing has been recorded against it yet."
      />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Students in this run</CardTitle>
            <CardDescription>
              {preview.canUndo} can be undone · {preview.blocked} must stay{preview.alreadyUndone ? ` · ${preview.alreadyUndone} already undone` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {preview.students.map((row) => (
                <li key={row.studentId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground block text-xs">{row.blocker ?? (row.kind === "GRADUATED" ? "Graduated — becomes a current student again" : "Goes back to last session's class")}</span>
                  </span>
                  <StatusBadge status={row.blocker ? "BLOCKED" : "OK"} label={row.blocker ? "Stays" : "Will be undone"} tone={row.blocker ? "warning" : "positive"} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Confirm</CardTitle>
            <CardDescription>Recorded in the activity log with your reason. Students who stay must be moved by hand.</CardDescription>
          </CardHeader>
          <CardContent>
            {preview.canUndo ? <PromotionUndoForm runId={preview.runId} count={preview.canUndo} /> : <p className="text-muted-foreground text-sm">Nobody in this run can be undone automatically.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
