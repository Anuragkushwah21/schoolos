import type { Metadata, Route } from "next";

import Link from "next/link";
import { ChevronLeftIcon, FileTextIcon, IdCardIcon, PenLineIcon, ShieldCheckIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { TONE_ICON } from "@/components/shared/tones";
import { Button } from "@/components/ui/button";
import { CardSheetPage, DocumentSheet, IdCard, IdCardBack } from "@/features/documents/document-view";
import { ZoomFrame } from "@/features/documents/zoom-frame";
import { CardFlip } from "@/features/documents/card-flip";
import { rupees } from "@/features/finance/money";
import { getStudentFees } from "@/server/finance/fees";
import { hasModule } from "@/server/platform/modules";
import { IssueDocumentForm } from "@/features/documents/forms";
import { DOCUMENT_LOOK } from "@/features/documents/person-documents";
import { Eyebrow, Panel, SoftRow, TileChip } from "@/features/people/profile-ui";
import { cn } from "@/lib/utils";
import { parseDateInput, toDateInput, today } from "@/lib/dates";
import { DOCUMENTS, type DocumentParam, type PersonKind, isDocumentType } from "@/lib/documents";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { type DocumentParams, buildDocument } from "@/server/documents/service";
import { principalUserIdFor } from "@/server/people/principals";

export const metadata: Metadata = { title: "New document" };

const KINDS: PersonKind[] = ["STUDENT", "TEACHER", "STAFF", "PRINCIPAL"];
const LABEL: Record<DocumentParam, string> = { examId: "Examination", purpose: "Purpose (optional)", conduct: "Conduct", reason: "Reason for leaving", leavingDate: "Date of leaving", exitDate: "Last working day", admissionDate: "Date of admission (if not on record)", duesCleared: "Fees and library books are cleared", issuedOn: "Issue date" };

/**
 * Preview a document for one person, then generate or issue it. The preview
 * is built from the records and the inputs on this form and saves nothing;
 * issuing re-checks everything on the server.
 */
export default async function NewDocumentPage(props: PageProps<"/school-admin/documents/new">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const search = await props.searchParams;
  const type = param(search.type);
  const kind = param(search.kind) as PersonKind | undefined;
  const personId = param(search.person) ?? "";
  if (!isDocumentType(type) || !kind || !KINDS.includes(kind) || !personId) {
    return <EmptyState title="Choose a document from a profile">Open a student, teacher or staff profile and choose a document there.</EmptyState>;
  }
  const meta = DOCUMENTS[type];
  const date = (name: string) => parseDateInput(param(search[name]) ?? "") ?? null;
  const params: DocumentParams = {
    examId: param(search.examId) ?? null,
    purpose: param(search.purpose) ?? null,
    conduct: param(search.conduct) ?? null,
    reason: param(search.reason) ?? null,
    leavingDate: date("leavingDate"),
    exitDate: date("exitDate"),
    admissionDate: date("admissionDate"),
    duesCleared: param(search.duesCleared) === "on",
    issuedOn: date("issuedOn") ?? today(),
  };
  const built = await buildDocument(ctx, { type, kind, personId, params }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Not available." }));
  if ("error" in built) return <EmptyState title="This document is not available">{built.error}</EmptyState>;

  // Exams for a marksheet: published exams of the student's own classes.
  // Marksheets: published exams of the student's classes. Admit cards: this session's exams of their current class that have papers.
  const exams = !meta.params.includes("examId")
    ? []
    : await ctx.db.exam.findMany({
        where: type === "ADMIT_CARD" ? { academicSession: { isCurrent: true }, papers: { some: {} }, section: { enrollments: { some: { studentId: personId, academicSession: { isCurrent: true } } } } } : { status: "PUBLISHED", section: { enrollments: { some: { studentId: personId } } } },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, academicSession: { select: { name: true } } },
      });
  // A TC's clearance, from the records: unpaid fees (School Admin, with fees) and library books not returned.
  const clearance =
    type === "TRANSFER_CERTIFICATE" && kind === "STUDENT"
      ? await Promise.all([
          ctx.user.role === "SCHOOL_ADMIN" && (await hasModule(ctx, "FINANCE")) ? getStudentFees(ctx, personId).then((fees) => fees.summary.pendingMinor, () => null) : Promise.resolve(null),
          (await hasModule(ctx, "LIBRARY")) ? ctx.db.bookIssue.count({ where: { studentId: personId, returnedOn: null } }) : Promise.resolve(null),
        ])
      : null;
  const keep = (extra: Record<string, string>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) if (typeof value === "string" && key !== "purpose") query.set(key, value);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    return ("/school-admin/documents/new?" + query.toString()) as Route;
  };
  const live = meta.kind === "ISSUED" ? await ctx.db.issuedDocument.findFirst({ where: { type, status: "ISSUED", ...(kind === "STUDENT" ? { studentId: personId } : kind === "TEACHER" ? { teacherId: personId } : kind === "PRINCIPAL" ? { principalProfileId: personId } : { staffMemberId: personId }) }, select: { number: true } }) : null;
  const forApproval = type === "TRANSFER_CERTIFICATE" && Boolean((await ctx.db.school.findFirst({ select: { tcApprovalRequired: true } }))?.tcApprovalRequired);
  const hidden: Record<string, string> = {
    type,
    kind,
    personId,
    ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== false).map(([key, value]) => [key, value instanceof Date ? toDateInput(value) : value === true ? "on" : String(value)])),
  };
  const back = (kind === "STUDENT" ? `/school-admin/students/${personId}?tab=documents` : kind === "TEACHER" ? `/school-admin/teachers/${personId}?tab=documents` : kind === "PRINCIPAL" ? `/school-admin/principal/${(await principalUserIdFor(ctx, [personId])).get(personId) ?? ""}` : `/school-admin/staff/${personId}?tab=documents`) as Route;
  const sheetMeta = { number: null, issuedOn: params.issuedOn ?? today(), status: "PREVIEW" as const, signatureSrc: built.content.signatory.hasSignature ? `/api/v1/documents/signatures/${built.content.signatory.role === "PRINCIPAL" ? "principal" : "admin"}` : null };

  const look = DOCUMENT_LOOK[type];
  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <Link href={back} className="text-muted-foreground hover:text-foreground inline-flex min-h-8 w-fit items-center gap-1 text-sm">
          <ChevronLeftIcon className="size-4" aria-hidden />
          {built.content.person.name}
        </Link>
        <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 p-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE_ICON[look.tone])}>
            <look.icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold tracking-tight">{`${meta.label} — ${built.content.person.name}`}</h1>
            <p className="text-muted-foreground text-xs">{meta.kind === "ISSUED" ? "Issuing gives it the school's next number and keeps it on the register." : "Generating records a printout; it has no official number."}</p>
          </div>
          <StatusBadge status={built.missing.length ? "PENDING" : "ACTIVE"} tone={built.missing.length ? "warning" : "positive"} label={built.missing.length ? "Needs details" : "Ready"} />
          <StatusBadge status="DRAFT" tone="info" label="Preview — nothing saved" />
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="force-light min-w-0 rounded-3xl bg-neutral-100 p-3 sm:p-6">
          {meta.card ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {["CR80 · 85.60 × 53.98 mm", "ISO/IEC 7810 ID-1 size", "Landscape", "Front and back"].map((chip) => (
                  <span key={chip} className="rounded-full border border-indigo-200 bg-white px-3 py-1 font-semibold text-indigo-800">
                    {chip}
                  </span>
                ))}
              </div>
              <ZoomFrame pageWidthMm={85.6 + 6}>
                <CardFlip front={<IdCard content={built.content} meta={sheetMeta} />} back={<IdCardBack content={built.content} meta={sheetMeta} />} />
              </ZoomFrame>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-neutral-700">A4 print sheet — 10 cards a page, at actual size</p>
                <ZoomFrame pageWidthMm={210}>
                  <CardSheetPage slots={[{ content: built.content, meta: sheetMeta, side: "front" }, ...Array.from({ length: 9 }, () => null)]} />
                </ZoomFrame>
              </div>
            </div>
          ) : (
            <ZoomFrame pageWidthMm={210} a4>
              <DocumentSheet content={built.content} meta={sheetMeta} type={type} />
            </ZoomFrame>
          )}
        </div>
        <div className="flex flex-col gap-5 xl:sticky xl:top-20">
          <Panel title="Generation settings" icon={SlidersHorizontalIcon} aside={<TileChip tone={built.missing.length ? "amber" : "green"}>{built.missing.length ? "Check" : "Ready"}</TileChip>}>
            <div className="flex flex-col gap-3 text-sm">
              <SoftRow>
                <IdCardIcon className="text-primary size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <Eyebrow>For</Eyebrow>
                  <span className="block truncate font-semibold">{built.content.person.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">{`${built.content.person.idLabel}: ${built.content.person.idValue}`}</span>
                </span>
              </SoftRow>
              <SoftRow>
                <PenLineIcon className="text-primary size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <Eyebrow>Signatory</Eyebrow>
                  <span className="block truncate font-semibold">{built.content.signatory.name ?? "Name not set"}</span>
                  <span className="text-muted-foreground block truncate text-xs">{`${built.content.signatory.title} · ${built.content.signatory.hasSignature ? "signature image on file" : "signed by hand"}`}</span>
                </span>
                {ctx.user.role === "SCHOOL_ADMIN" ? (
                  <Link href="/school-admin/settings/documents" className="text-primary shrink-0 text-xs font-semibold hover:underline">
                    Change
                  </Link>
                ) : null}
              </SoftRow>
              <SoftRow>
                <FileTextIcon className="text-primary size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <Eyebrow>Page</Eyebrow>
                  <span className="block font-semibold">{meta.card ? "ID card · 85.60 × 53.98 mm, landscape, front and back" : "A4 · 210 × 297 mm, portrait"}</span>
                </span>
              </SoftRow>
              {meta.params.length ? (
                <form method="get" className="flex flex-col gap-3 border-t pt-3">
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="person" value={personId} />
                  {meta.params.map((name) =>
                    name === "duesCleared" ? (
                      <label key={name} className="flex items-start gap-2">
                        <input type="checkbox" name={name} defaultChecked={params.duesCleared} className="mt-0.5 size-4" />
                        {LABEL[name]}
                      </label>
                    ) : name === "examId" ? (
                      <label key={name} className="flex flex-col gap-1">
                        <span className="font-medium">{LABEL[name]}</span>
                        <select name={name} defaultValue={params.examId ?? ""} className="border-input bg-background h-10 rounded-lg border px-2">
                          <option value="">{exams.length ? "Choose the examination" : type === "ADMIT_CARD" ? "No examination with papers this session" : "No published examination"}</option>
                          {exams.map((exam) => (
                            <option key={exam.id} value={exam.id}>{`${exam.name} (${exam.academicSession.name})`}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label key={name} className="flex flex-col gap-1">
                        <span className="font-medium">{LABEL[name]}</span>
                        <input
                          name={name}
                          type={name.endsWith("Date") || name === "issuedOn" ? "date" : "text"}
                          defaultValue={(() => {
                            const value = params[name as keyof DocumentParams];
                            return value instanceof Date ? toDateInput(value) : typeof value === "string" ? value : "";
                          })()}
                          className="border-input bg-background h-10 rounded-lg border px-2"
                        />
                      </label>
                    ),
                  )}
                  {meta.params.includes("purpose") ? (
                    <div className="flex flex-wrap gap-1.5">
                      {["a scholarship", "a passport / visa", "admission to another school", "a bank account"].map((purpose) => (
                        <Link key={purpose} href={keep({ purpose })} className={cn("rounded-full border px-3 py-1 text-xs font-medium", params.purpose === purpose ? "border-primary bg-primary-soft text-primary-strong" : "bg-card hover:bg-muted")}>
                          {purpose}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-muted-foreground text-xs">Reviewed by you — nothing here is filled in by guesswork.</p>
                  <div>
                    <Button type="submit" variant="outline" size="sm">
                      Update preview
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </Panel>
          {clearance ? (
            <Panel title="Clearance check" icon={ShieldCheckIcon} tone="cyan" description="From the school's records — you still confirm it on the form.">
              <ul className="flex flex-col gap-2 text-sm">
                {[
                  { label: "Fees", value: clearance[0] === null ? "Not checked here" : clearance[0] > 0 ? `${rupees(clearance[0])} pending` : "Nothing pending", ok: clearance[0] === null ? null : clearance[0] <= 0 },
                  { label: "Library books", value: clearance[1] === null ? "No library module" : clearance[1] ? `${clearance[1]} not returned` : "All returned", ok: clearance[1] === null ? null : clearance[1] === 0 },
                ].map((row) => (
                  <SoftRow key={row.label} className="justify-between py-2.5">
                    <span className="font-medium">{row.label}</span>
                    <TileChip tone={row.ok === null ? "neutral" : row.ok ? "green" : "red"}>{row.value}</TileChip>
                  </SoftRow>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel title={built.missing.length ? "Missing — fix before continuing" : forApproval ? "Send for approval" : meta.kind === "ISSUED" ? "Issue this document" : "Generate this document"} icon={built.missing.length ? TriangleAlertIcon : ShieldCheckIcon} tone={built.missing.length ? "red" : "green"}>
            {built.missing.length ? (
              <ul className="text-destructive list-disc pl-5 text-sm">
                {built.missing.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">Everything required is in place.</p>
            )}
            {built.warnings.length ? (
              <ul className="text-warning-strong mt-2 list-disc pl-5 text-xs">
                {built.warnings.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4">
              <IssueDocumentForm hidden={hidden} official={meta.kind === "ISSUED"} alreadyIssued={live?.number ?? null} needsConfirm={type === "TRANSFER_CERTIFICATE"} disabled={built.missing.length > 0} forApproval={forApproval} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
