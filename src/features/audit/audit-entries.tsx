import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/format";

export type AuditRow = {
  id: string;
  action: string;
  module: string | null;
  actorRole: string | null;
  summary: string;
  metadata: unknown;
  createdAt: Date;
  actor: { firstName: string; lastName: string } | { name: string; role?: string } | null;
};

type Change = { label: string; old: string | null; new: string | null };

function changesOf(metadata: unknown): Change[] {
  const list = metadata && typeof metadata === "object" ? (metadata as { changes?: unknown }).changes : null;
  if (!Array.isArray(list)) return [];
  return list.filter((row): row is Change => Boolean(row) && typeof row === "object" && "label" in row);
}

function actorName(actor: AuditRow["actor"]): string {
  if (!actor) return "System";
  return "name" in actor ? actor.name : `${actor.firstName} ${actor.lastName}`;
}

/**
 * Audit entries in words — "Rahul Sharma (Accountant) · Fees" and what
 * happened — with field changes (old → new) and the raw details folded away.
 */
export function AuditEntries({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>;
  return (
    <ol className="divide-y">
      {rows.map((row) => {
        const changes = changesOf(row.metadata);
        return (
          <li key={row.id} className="flex flex-col gap-1 py-3">
            <p className="text-sm">{row.summary}</p>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-foreground font-medium">{actorName(row.actor)}</span>
              {row.actorRole ? <span>({row.actorRole})</span> : null}
              <span>· {formatDateTime(row.createdAt)}</span>
              {row.module ? <StatusBadge status="INFO" tone="info" label={row.module} /> : null}
            </p>
            {changes.length ? (
              <table className="mt-1 w-full max-w-xl text-xs">
                <tbody>
                  {changes.map((change) => (
                    <tr key={change.label} className="border-t">
                      <td className="text-muted-foreground py-1 pr-3">{change.label}</td>
                      <td className="py-1 pr-3 line-through opacity-70">{change.old ?? "—"}</td>
                      <td className="py-1">{change.new ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">Details</summary>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Action</dt>
                <dd>{humanize(row.action)}</dd>
                <dt className="text-muted-foreground">Entry</dt>
                <dd className="font-mono">{row.id}</dd>
              </dl>
              {row.metadata ? <pre className="bg-muted/50 mt-1 overflow-x-auto rounded p-2">{JSON.stringify(row.metadata, null, 2)}</pre> : null}
            </details>
          </li>
        );
      })}
    </ol>
  );
}
