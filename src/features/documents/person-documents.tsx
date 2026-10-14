import type { Route } from "next";
import Link from "next/link";
import {
  AwardIcon,
  BadgeCheckIcon,
  CalendarCheckIcon,
  FileCheckIcon,
  FileOutputIcon,
  FileSignatureIcon,
  FileSpreadsheetIcon,
  FolderOpenIcon,
  IdCardIcon,
  LockIcon,
  LogOutIcon,
  type LucideIcon,
  PrinterIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  TicketIcon,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { type AccentTone, TONE_ICON } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/people/profile-ui";
import { formatDate } from "@/lib/dates";
import { DOCUMENTS, type DocumentType, type PersonKind, documentLabel, documentsFor } from "@/lib/documents";
import { cn } from "@/lib/utils";
import type { TenantContext } from "@/server/auth/current-user";
import { assertDocumentAccess, documentsOf } from "@/server/documents/service";

import { ApprovalForms, RevokeDocumentForm } from "./forms";

export const DOCUMENT_STATUS: Record<string, { label: string; tone: "positive" | "neutral" | "warning" | "negative" | "info" }> = {
  GENERATED: { label: "Generated", tone: "info" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  ISSUED: { label: "Issued", tone: "positive" },
  REVOKED: { label: "Revoked", tone: "negative" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

/** Each document's icon and colour, so a register reads at a glance. */
export const DOCUMENT_LOOK: Record<DocumentType, { icon: LucideIcon; tone: AccentTone }> = {
  STUDENT_ID_CARD: { icon: IdCardIcon, tone: "cyan" },
  BONAFIDE_CERTIFICATE: { icon: BadgeCheckIcon, tone: "blue" },
  CHARACTER_CERTIFICATE: { icon: AwardIcon, tone: "purple" },
  ATTENDANCE_CERTIFICATE: { icon: CalendarCheckIcon, tone: "green" },
  ENROLLMENT_CONFIRMATION: { icon: FileCheckIcon, tone: "purple" },
  TRANSFER_CERTIFICATE: { icon: FileOutputIcon, tone: "red" },
  MARKSHEET: { icon: FileSpreadsheetIcon, tone: "blue" },
  STAFF_ID_CARD: { icon: IdCardIcon, tone: "cyan" },
  APPOINTMENT_LETTER: { icon: FileSignatureIcon, tone: "blue" },
  EMPLOYMENT_VERIFICATION: { icon: ShieldCheckIcon, tone: "green" },
  EXPERIENCE_CERTIFICATE: { icon: AwardIcon, tone: "purple" },
  RELIEVING_LETTER: { icon: LogOutIcon, tone: "orange" },
  SALARY_CERTIFICATE: { icon: WalletIcon, tone: "orange" },
  SERVICE_CERTIFICATE: { icon: ScrollTextIcon, tone: "cyan" },
  ADMIT_CARD: { icon: TicketIcon, tone: "orange" },
};

const newHref = (type: DocumentType, kind: PersonKind, personId: string) => `/school-admin/documents/new?type=${type}&kind=${kind}&person=${personId}` as Route;
const printHref = (id: string) => `/documents/print?ids=${id}` as Route;

/** The documents this user may make for this kind of person, and those they may not (with the reason). */
async function documentChoices(ctx: TenantContext, kind: PersonKind) {
  const allowed: DocumentType[] = [];
  const locked: Array<{ type: DocumentType; reason: string }> = [];
  for (const type of documentsFor(kind)) {
    const reason = await assertDocumentAccess(ctx, type, "EDIT", kind).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : "Not available to you."),
    );
    if (reason) locked.push({ type, reason });
    else allowed.push(type);
  }
  return { allowed, locked };
}

/**
 * A profile's document centre: one card per document this user may make for
 * this person — its latest copy's status and number, preview, issue and
 * print — then every copy on record, with revoke. Documents this user may not
 * make show as locked with the reason. Student documents never appear for
 * staff, and the other way round.
 */
export async function PersonDocuments({ ctx, kind, personId }: { ctx: TenantContext; kind: PersonKind; personId: string }) {
  const [{ allowed, locked }, rows] = await Promise.all([documentChoices(ctx, kind), documentsOf(ctx, kind, personId)]);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.type)) latest.set(row.type, row);
  const live = rows.filter((row) => row.status === "ISSUED" || row.status === "GENERATED").length;

  return (
    <div id="documents" className="flex scroll-mt-24 flex-col gap-5">
      <Panel
        title="Documents"
        icon={FolderOpenIcon}
        description="Preview first — nothing is issued until you confirm. Print or save as PDF from the document."
        aside={<StatusBadge status="ACTIVE" tone="info" label={`${live} on record`} />}
      >
        <ul className="grid gap-3 md:grid-cols-2">
          {allowed.map((type) => {
            const meta = DOCUMENTS[type];
            const look = DOCUMENT_LOOK[type];
            const last = latest.get(type);
            const current = last && (last.status === "ISSUED" || last.status === "GENERATED") ? last : null;
            return (
              <li key={type} className="bg-card flex flex-col gap-3 rounded-2xl border border-border/70 p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONE_ICON[look.tone])}>
                    <look.icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="leading-tight font-semibold">{meta.label}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">{meta.hint}</p>
                  </div>
                  {last ? (
                    <StatusBadge status={last.status} label={DOCUMENT_STATUS[last.status]!.label} tone={DOCUMENT_STATUS[last.status]!.tone} />
                  ) : (
                    <StatusBadge status="NEW" tone="neutral" label="Not made yet" />
                  )}
                </div>
                <div className="bg-muted/60 text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs">
                  <span>{last ? `${last.status === "GENERATED" ? "Generated" : "Issued"} on ${formatDate(last.issuedOn)}` : meta.kind === "ISSUED" ? "Official — numbered when issued" : "A printout — no official number"}</span>
                  {last?.number ? <span className="text-foreground font-mono font-medium">{last.number}</span> : null}
                </div>
                <div className="mt-auto flex flex-wrap justify-end gap-2">
                  {current ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={printHref(current.id)} target="_blank">
                        <PrinterIcon aria-hidden />
                        Print / PDF
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant={current ? "secondary" : "default"}>
                    <Link href={newHref(type, kind, personId)}>
                      <SparklesIcon aria-hidden />
                      {current ? (meta.kind === "ISSUED" ? "Issue again" : "Make again") : meta.kind === "ISSUED" ? "Preview & issue" : "Preview & generate"}
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
          {locked.map(({ type, reason }) => {
            const look = DOCUMENT_LOOK[type];
            return (
              <li key={type} className="bg-muted/40 flex items-start gap-3 self-start rounded-2xl border border-dashed p-4 opacity-80">
                <span className="bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <look.icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="leading-tight font-semibold">{DOCUMENTS[type].label}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">{reason}</p>
                </div>
                <StatusBadge status="LOCKED" tone="neutral" label="Locked" />
              </li>
            );
          })}
        </ul>
        {kind === "STUDENT" ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Report cards come from published results —{" "}
            <Link href={`/school-admin/students/${personId}?tab=academics` as Route} className="text-primary font-medium hover:underline">
              see Academics
            </Link>
            .
          </p>
        ) : null}
      </Panel>

      <Panel title="Every copy on record" icon={LockIcon} tone="neutral" description="Issued documents are never edited or deleted — revoke one, or issue it again to supersede it.">
        {rows.length ? (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const look = DOCUMENT_LOOK[row.type as DocumentType];
              return (
                <li key={row.id} className="bg-muted/50 flex flex-col gap-2 rounded-2xl p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {look ? (
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONE_ICON[look.tone])}>
                        <look.icon className="size-4" aria-hidden />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{documentLabel(row.type)}</span>
                      <span className="text-muted-foreground block text-xs">{`${row.number ? `${row.number} · ` : ""}${formatDate(row.issuedOn)}`}</span>
                    </span>
                    <StatusBadge status={row.status} label={DOCUMENT_STATUS[row.status]!.label} tone={DOCUMENT_STATUS[row.status]!.tone} />
                    <Button asChild variant="ghost" size="xs">
                      <Link href={printHref(row.id)} target="_blank">
                        <PrinterIcon aria-hidden />
                        Print / PDF
                      </Link>
                    </Button>
                  </div>
                  {row.revokeReason ? <p className="text-muted-foreground text-xs">{`Revoked: ${row.revokeReason}`}</p> : null}
                  {row.status === "PENDING_APPROVAL" ? <ApprovalForms documentId={row.id} mine={row.generatedById === ctx.user.id} /> : null}
                  {row.status === "ISSUED" ? (
                    <details className="text-xs">
                      <summary className="text-muted-foreground cursor-pointer">Revoke</summary>
                      <div className="mt-2 max-w-sm">
                        <RevokeDocumentForm documentId={row.id} />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No documents yet.</p>
        )}
      </Panel>
    </div>
  );
}

/**
 * The overview's shortcut strip: the documents this user may make for
 * this person, straight to the preview. Shown only when there is at least one.
 */
export async function DocumentShortcuts({ ctx, kind, personId, picks, more }: { ctx: TenantContext; kind: PersonKind; personId: string; picks: DocumentType[]; more: string }) {
  const { allowed } = await documentChoices(ctx, kind);
  const shown = picks.filter((type) => allowed.includes(type)).slice(0, 6);
  if (!shown.length) return null;
  return (
    <section className="bg-primary-soft/70 rounded-3xl border border-primary/15 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="bg-primary flex size-9 shrink-0 items-center justify-center rounded-xl text-white">
          <ShieldCheckIcon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Document generator</p>
          <p className="text-muted-foreground text-xs">From the school&apos;s records, with your letterhead and signatory. Preview before anything is issued.</p>
        </div>
        <Link href={more as Route} className="text-primary shrink-0 text-sm font-semibold hover:underline">
          All documents
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {shown.map((type) => {
          const look = DOCUMENT_LOOK[type];
          return (
            <Link key={type} href={newHref(type, kind, personId)} className="bg-card hover:border-primary/40 flex items-center gap-2.5 rounded-xl border border-border/70 px-3 py-2.5 text-sm font-semibold shadow-sm transition-colors">
              <look.icon className="text-primary size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{DOCUMENTS[type].label}</span>
              <SparklesIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
