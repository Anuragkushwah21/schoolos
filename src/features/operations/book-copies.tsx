import type { Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";

import { restoreCopyAction } from "./actions";
import { CopyConditionForm } from "./copy-condition-form";

type Copy = { id: string; code: string; status: string; heldBy: string | null; dueOn: Date | null; conditionNote?: string | null };

const LABEL: Record<string, { label: string; tone: "positive" | "info" | "neutral" | "warning" | "negative" }> = {
  AVAILABLE: { label: "Available", tone: "positive" },
  ISSUED: { label: "Issued", tone: "info" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  LOST: { label: "Lost", tone: "negative" },
  DAMAGED: { label: "Damaged", tone: "warning" },
};

/**
 * A book's physical copies. The librarian can take a lost or damaged copy out
 * of stock (its loans stay on record) and put it back if it turns up.
 */
export function BookCopiesCard({ copies, canManage, historyHref }: { copies: Copy[]; canManage: boolean; /** The book's page: each copy links to its own history there. */ historyHref?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Copies</CardTitle>
        <CardDescription>Lost or damaged copies leave stock but keep their history.</CardDescription>
      </CardHeader>
      <CardContent>
        {copies.length ? (
          <ul className="divide-y text-sm">
            {copies.map((copy) => {
              const label = LABEL[copy.status] ?? { label: copy.status, tone: "neutral" as const };
              const inStock = copy.status === "AVAILABLE" || copy.status === "ISSUED";
              return (
                <li key={copy.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{copy.code}</span>
                    <span className="flex-1 text-xs">
                      {copy.heldBy ? `With ${copy.heldBy}${copy.dueOn ? `, due ${formatDate(copy.dueOn)}` : ""}` : copy.conditionNote ?? ""}
                    </span>
                    <StatusBadge status={copy.status} tone={label.tone} label={label.label} />
                    {historyHref ? (
                      <Link href={`${historyHref}?copy=${copy.id}#history` as Route} className="text-primary text-xs font-medium hover:underline">
                        History
                      </Link>
                    ) : null}
                    {canManage && (copy.status === "LOST" || copy.status === "DAMAGED") ? (
                      <ActionButton action={restoreCopyAction} fields={{ copyId: copy.id }} variant="ghost">
                        Back in stock
                      </ActionButton>
                    ) : null}
                  </div>
                  {canManage && inStock ? <CopyConditionForm copyId={copy.id} onLoan={copy.status === "ISSUED"} /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No copies.</p>
        )}
      </CardContent>
    </Card>
  );
}
