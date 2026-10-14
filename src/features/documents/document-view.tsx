import { GraduationCapIcon, PhoneIcon } from "lucide-react";

import { formatDate } from "@/lib/dates";
import type { DocumentContent, DocumentType } from "@/lib/documents";
import { cn } from "@/lib/utils";

/**
 * How a document looks on paper, at its real size — in the school's design
 * language: white paper, indigo accents, a lavender pill for the title, soft
 * rounded panels, a clean sans-serif.
 *
 *   * Certificates (bonafide, character, attendance, experience, service,
 *     salary, verification): A4 portrait, centred emblem and letterhead,
 *     reference bar, pill title, the person's name in indigo in the text,
 *     a signature panel.
 *   * Letters (appointment, relieving): A4 portrait business letter.
 *   * Transfer certificate: A4, the pupil's card, numbered particulars,
 *     prepared-by / checked-by / signatory cards.
 *   * Admit card: A4, the candidate's panel with photo, the paper schedule.
 *   * Marksheet: A4, exam-focused.
 *   * ID cards: ID-1 landscape, 85.60 × 53.98 mm, front and back; ten to an
 *     A4 sheet at actual size.
 *
 * Everything shown comes from the document's content — the school's own
 * branding and the person's records as they were when it was made. Blank
 * lines and the dashed seal circle are for handwriting and the school's own
 * rubber stamp; nothing is printed in them. A preview, a document waiting for
 * approval, a revoked and a superseded one say so across the page.
 */

export type SheetMeta = { id?: string; number: string | null; issuedOn: Date; status: "PREVIEW" | "GENERATED" | "PENDING_APPROVAL" | "ISSUED" | "REVOKED" | "SUPERSEDED"; signatureSrc?: string | null };

const STAMP: Partial<Record<SheetMeta["status"], string>> = { PREVIEW: "Preview — not issued", PENDING_APPROVAL: "Pending approval — not issued", REVOKED: "Revoked", SUPERSEDED: "Superseded" };

function Stamp({ status, small }: { status: SheetMeta["status"]; small?: boolean }) {
  const text = STAMP[status];
  if (!text) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
      <span className={cn("-rotate-[24deg] font-black tracking-widest whitespace-nowrap text-red-600/20 uppercase", small ? "text-[9pt]" : "text-5xl")}>{text}</span>
    </div>
  );
}

const notYet = (meta: SheetMeta) => meta.number ?? (meta.status === "PREVIEW" || meta.status === "PENDING_APPROVAL" ? "given when issued" : "—");

/** "Green Valley Academy" → "GV". */
function monogram(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((word) => /^[A-Za-zऀ-ॿ]/.test(word))
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("") || "S"
  );
}

/**
 * The school's mark: its logo, contained whole in a box of fixed height that
 * may grow up to 2.4× as wide (never cropped or stretched); without a logo, a
 * graduation cap in a soft circle.
 */
function Emblem({ school, sizeMm, variant = "circle" }: { school: DocumentContent["school"]; sizeMm: number; variant?: "circle" | "tile" }) {
  if (school.logoUrl) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", variant === "tile" && "rounded-[1.6mm] bg-white p-[0.5mm] ring-1 ring-indigo-100")} style={{ height: sizeMm + "mm", maxWidth: sizeMm * 2.4 + "mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the school's own logo URL, printed as-is */}
        <img src={school.logoUrl} alt="" className="logo-img h-full max-h-full w-auto max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center", variant === "tile" ? "rounded-[1.8mm] bg-indigo-600 text-white" : "rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100")}
      style={{ width: sizeMm + "mm", height: sizeMm + "mm" }}
      title={monogram(school.name)}
    >
      <GraduationCapIcon style={{ width: sizeMm * 0.52 + "mm", height: sizeMm * 0.52 + "mm" }} aria-hidden />
    </span>
  );
}

/**
 * A person's photo in a fixed frame: `cover` so the frame is always filled
 * without stretching, anchored near the top so a portrait keeps the face (a
 * landscape photo is cropped at the sides, not squashed). No photo: initials
 * and "No photo".
 */
function PersonPhoto({ person, className, initialsClass }: { person: DocumentContent["person"]; className: string; initialsClass: string }) {
  return (
    <div className={cn(className, "photo-frame flex shrink-0 flex-col items-center justify-center overflow-hidden bg-slate-100")}>
      {person.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private photo served after an access check
        <img src={person.photoUrl} alt="" className="photo-img size-full object-cover object-[50%_22%]" />
      ) : (
        <>
          <span className={cn("font-bold text-indigo-700", initialsClass)}>{monogram(person.name)}</span>
          <span className="text-[0.5em] tracking-wider text-slate-400 uppercase">No photo</span>
        </>
      )}
    </div>
  );
}

/** Long names step down in size instead of being cut off. */
function nameSize(name: string, sizes: [string, string, string]) {
  return name.length > 34 ? sizes[2] : name.length > 22 ? sizes[1] : sizes[0];
}

/** The person's name, wherever it appears in the text, in indigo. */
function Emphasis({ text, name }: { text: string; name: string }) {
  if (!name || !text.includes(name)) return <>{text}</>;
  const parts = text.split(name);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? <strong className="font-semibold text-indigo-700">{name}</strong> : null}
        </span>
      ))}
    </>
  );
}

function contactLine(school: DocumentContent["school"]) {
  return [school.phone ? `Tel: ${school.phone}` : null, school.email ? `Email: ${school.email}` : null, school.udiseCode ? `UDISE: ${school.udiseCode}` : null].filter(Boolean).join("  ·  ");
}

/** Centred letterhead: emblem, school name, affiliation line, address and contact. */
function Letterhead({ school, accent = false }: { school: DocumentContent["school"]; accent?: boolean }) {
  const contact = contactLine(school);
  return (
    <header className="flex flex-col items-center gap-1 text-center">
      <Emblem school={school} sizeMm={15} />
      <p className={cn(school.name.length > 40 ? "text-[19px]" : "text-[23px]", "mt-1.5 leading-tight font-extrabold tracking-tight uppercase", accent ? "text-indigo-700" : "text-slate-900")}>{school.name}</p>
      {school.headerNote ? <p className="text-[11px] font-semibold tracking-wide text-slate-600 uppercase">{school.headerNote}</p> : null}
      {school.address ? <p className="text-[11px] text-slate-500">{school.address}</p> : null}
      {contact ? <p className="text-[11px] text-slate-500">{contact}</p> : null}
    </header>
  );
}

/** The lavender pill title. */
function PillTitle({ children, sub }: { children: React.ReactNode; sub?: string | null }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-1.5">
      <h1 className="rounded-full bg-indigo-100 px-10 py-3 text-center text-[17px] font-extrabold tracking-wide text-indigo-800 uppercase">{children}</h1>
      {sub ? <p className="text-[12px] font-medium text-slate-500">{sub}</p> : null}
    </div>
  );
}

function RefBar({ meta, label = "Ref" }: { meta: SheetMeta; label?: string }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-2.5 text-[11.5px] ring-1 ring-slate-100">
      <p>
        <span className="mr-1.5 font-semibold tracking-wider text-slate-500 uppercase">{label}:</span>
        <span className="font-mono font-bold text-slate-900">{notYet(meta)}</span>
      </p>
      <p>
        <span className="mr-1.5 font-semibold tracking-wider text-slate-500 uppercase">Date:</span>
        <span className="font-bold text-slate-900">{formatDate(meta.issuedOn)}</span>
      </p>
    </div>
  );
}

function SealCircle({ size = "size-[24mm]" }: { size?: string }) {
  return (
    <span className={cn(size, "flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-indigo-200 text-center text-[9px] leading-tight tracking-wider text-indigo-300 uppercase")}>
      School
      <br />
      seal
    </span>
  );
}

/** One signer: the signature image (contained, never stretched) or a blank line to sign by hand. */
function Signer({ name, title, src }: { name: string | null; title: string; src?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <div className="flex h-14 w-full items-end justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private image served after an access check
          <img src={src} alt="Signature" className="max-h-14 max-w-[55mm] object-contain" />
        ) : null}
      </div>
      <div className="w-full border-t border-slate-400 pt-1.5">
        {name ? <p className="text-[12.5px] font-bold text-slate-900">{name}</p> : null}
        <p className="text-[11px] text-slate-500">{title}</p>
      </div>
    </div>
  );
}

function Footer({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  return (
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-[10px] text-slate-500">
      <span>{content.school.footerNote ?? "Prepared from the school's records."}</span>
      {meta.number ? <span className="font-mono">{meta.number}</span> : null}
    </footer>
  );
}

/** A faint emblem behind the text (decoration only). */
function Watermark() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center text-indigo-900 opacity-[0.035]">
      <GraduationCapIcon className="size-[120mm]" strokeWidth={1.2} />
    </span>
  );
}

const PAGE = "document-sheet relative isolate mx-auto flex min-h-[297mm] w-[210mm] shrink-0 flex-col bg-white text-slate-900 shadow-sm ring-1 ring-slate-200";

// -----------------------------------------------------------------------------
// A4 layouts
// -----------------------------------------------------------------------------

/** A certificate: centred letterhead, reference bar, pill title, body, signature panel. ~18 mm margins. */
function CertificateSheet({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const student = content.person.kind === "STUDENT";
  return (
    <article className={cn(PAGE, "overflow-hidden px-[18mm] pt-[12mm] pb-[12mm]")}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2.2mm] bg-[linear-gradient(90deg,#4338ca,#06b6d4,#7c3aed)]" />
      <Stamp status={meta.status} />
      <Watermark />
      <Letterhead school={content.school} />
      <RefBar meta={meta} />
      <PillTitle>{content.title}</PillTitle>
      {content.fields.length ? (
        <dl className="mt-6 grid grid-cols-2 gap-2 text-[12.5px]">
          {content.fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-slate-50 px-3.5 py-2 ring-1 ring-slate-100">
              <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{field.label}</dt>
              <dd className="font-semibold break-words text-slate-900">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-6 flex flex-col gap-4 text-justify text-[14.5px] leading-[1.8] text-slate-800">
        {content.body.map((paragraph, index) => (
          <p key={index}>
            <Emphasis text={paragraph} name={content.person.name} />
          </p>
        ))}
      </div>
      <div className="flex-1" />
      <div className="keep-together mt-10 rounded-2xl bg-slate-50 px-6 py-5 ring-1 ring-slate-100">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-6">
          {student ? (
            <Signer name={null} title="Class teacher" />
          ) : (
            <div className="text-[12px] text-slate-600">
              <p>
                <span className="text-slate-400">Date: </span>
                <span className="font-semibold text-slate-900">{formatDate(meta.issuedOn)}</span>
              </p>
              <p>
                <span className="text-slate-400">Place: </span>
                <span className="font-semibold text-slate-900">{content.school.city || "—"}</span>
              </p>
            </div>
          )}
          <SealCircle size="size-[22mm]" />
          <Signer name={content.signatory.name} title={content.signatory.title} src={meta.signatureSrc} />
        </div>
      </div>
      <Footer content={content} meta={meta} />
    </article>
  );
}

/** A business letter on the letterhead: ~22 mm margins. */
function LetterSheet({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const letter = content.letter!;
  const [salutation, ...paragraphs] = content.body;
  const contact = contactLine(content.school);
  return (
    <article className={cn(PAGE, "overflow-hidden px-[22mm] pt-[14mm] pb-[12mm]")}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2.2mm] bg-[linear-gradient(90deg,#4338ca,#06b6d4,#7c3aed)]" />
      <Stamp status={meta.status} />
      <header className="flex items-center gap-4 border-b border-slate-200 pb-4">
        <Emblem school={content.school} sizeMm={15} />
        <div className="min-w-0 flex-1">
          <p className={cn(content.school.name.length > 40 ? "text-[17px]" : "text-[21px]", "leading-tight font-extrabold tracking-tight text-slate-900 uppercase")}>{content.school.name}</p>
          {content.school.headerNote ? <p className="text-[10.5px] font-semibold tracking-wide text-slate-600 uppercase">{content.school.headerNote}</p> : null}
        </div>
        <div className="max-w-[62mm] text-right text-[10.5px] leading-snug text-slate-500">
          {content.school.address ? <p>{content.school.address}</p> : null}
          {contact ? <p>{contact}</p> : null}
        </div>
      </header>
      <RefBar meta={meta} label="Ref. no." />
      <div className="mt-6 text-[13px] leading-relaxed">
        <p className="text-slate-500">To,</p>
        {letter.to.map((line, index) => (
          <p key={index} className={index === 0 ? "font-bold text-slate-900" : "text-slate-700"}>
            {line}
          </p>
        ))}
      </div>
      <p className="mt-5 rounded-lg bg-indigo-50 px-4 py-2.5 text-[13px] text-indigo-900">
        <span className="font-bold">Subject: </span>
        <span className="font-semibold">{letter.subject}</span>
      </p>
      <div className="mt-5 flex flex-col gap-3.5 text-justify text-[14px] leading-[1.75] text-slate-800">
        {salutation ? <p>{salutation}</p> : null}
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      {content.fields.length ? (
        <dl className="mt-5 grid grid-cols-2 gap-2 text-[12.5px]">
          {content.fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-slate-50 px-3.5 py-2 ring-1 ring-slate-100">
              <dt className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{field.label}</dt>
              <dd className="font-semibold break-words text-slate-900">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="keep-together mt-8 flex items-end justify-between gap-6 text-[13px]">
        <div className="w-[62mm]">
          <p>Yours sincerely,</p>
          <p className="mb-1 text-[12px] text-slate-500">{`For ${content.school.name}`}</p>
          <Signer name={content.signatory.name} title={content.signatory.title} src={meta.signatureSrc} />
        </div>
        <SealCircle size="size-[22mm]" />
      </div>
      <div className="flex-1" />
      {letter.acknowledgement ? (
        <div className="keep-together mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-[11.5px]">
          <p className="font-bold tracking-wider text-indigo-800 uppercase">Acknowledgement</p>
          <p className="mt-1 text-slate-600">{`I have received this letter. — ${content.person.name}`}</p>
          <div className="mt-6 flex justify-between gap-6 text-slate-500">
            <span className="w-[60mm] border-t border-slate-400 pt-1">Signature</span>
            <span className="w-[40mm] border-t border-slate-400 pt-1">Date</span>
          </div>
        </div>
      ) : null}
      <Footer content={content} meta={meta} />
    </article>
  );
}

/** The transfer certificate: the pupil's card, numbered particulars, signing cards. ~15 mm margins. */
function TransferCertificateSheet({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const value = (label: string) => content.fields.find((field) => field.label === label)?.value ?? null;
  const lastClass = value("Class last studied");
  const rows = content.fields.filter((field) => field.label !== "Name of student" && field.label !== "Admission no.");
  return (
    <article className={cn(PAGE, "overflow-hidden px-[15mm] pt-[12mm] pb-[10mm]")}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2.2mm] bg-[linear-gradient(90deg,#4338ca,#06b6d4,#7c3aed)]" />
      <Stamp status={meta.status} />
      <Watermark />
      <Letterhead school={content.school} />
      <PillTitle sub={meta.number ? `TC no. ${meta.number}  ·  Issued ${formatDate(meta.issuedOn)}` : `TC no. ${notYet(meta)}  ·  ${formatDate(meta.issuedOn)}`}>Transfer / school leaving certificate</PillTitle>
      <div className="keep-together mt-5 flex items-center gap-4 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
        <PersonPhoto person={content.person} className="h-[22mm] w-[18mm] rounded-lg ring-2 ring-white" initialsClass="text-[13pt]" />
        <div className="min-w-0 flex-1">
          <p className={cn(nameSize(content.person.name, ["text-[18px]", "text-[16px]", "text-[14px]"]), "leading-tight font-extrabold break-words text-slate-900")}>{content.person.name}</p>
          {lastClass ? <p className="text-[12px] text-slate-600">{lastClass}</p> : null}
          <p className="text-[12px] font-semibold text-indigo-700">{`${content.person.idLabel}: ${content.person.idValue}`}</p>
        </div>
      </div>
      <ol className="mt-4 flex flex-col gap-1.5 text-[12.5px]">
        {rows.map((field, index) => (
          <li key={field.label} className={cn("flex items-start gap-3 rounded-lg px-3.5 py-2", index % 2 ? "bg-white ring-1 ring-slate-100" : "bg-slate-50")}>
            <span className="w-[56%] shrink-0 text-slate-600">{`${index + 1}. ${field.label}`}</span>
            <span className="min-w-0 flex-1 text-right font-semibold break-words text-slate-900">{field.value}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-col gap-2 text-[13px] leading-relaxed text-slate-700">
        {content.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="flex-1" />
      <div className="keep-together mt-8 grid grid-cols-[1fr_1fr_auto_1fr] items-end gap-4">
        {[
          { title: "Prepared by", note: "Name and signature" },
          { title: "Checked by", note: "Name and signature" },
        ].map((card) => (
          <div key={card.title} className="rounded-xl bg-slate-50 px-3 pt-12 pb-2.5 text-center ring-1 ring-slate-100">
            <p className="border-t border-slate-400 pt-1.5 text-[12px] font-bold text-slate-900">{card.title}</p>
            <p className="text-[10.5px] text-slate-500">{card.note}</p>
          </div>
        ))}
        <SealCircle size="size-[22mm]" />
        <div className="rounded-xl bg-indigo-50/70 px-3 pt-1 pb-2.5 ring-1 ring-indigo-100">
          <Signer name={content.signatory.name} title={content.signatory.title} src={meta.signatureSrc} />
        </div>
      </div>
      <Footer content={content} meta={meta} />
    </article>
  );
}

/** The examination marksheet: student panel, marks table, summary tiles, signatures. ~12 mm margins. */
function MarksheetSheet({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const examName = content.title.split(" — ")[1] ?? null;
  const table = content.table;
  const total = table?.foot.find((row) => row[0] === "Total");
  const summary = [
    ...(total ? [{ label: "Total", value: `${total[3]} / ${total[1]}` }] : []),
    ...(table?.foot.filter((row) => row[0] !== "Total").map((row) => ({ label: row[0] ?? "", value: row[3] || "—" })) ?? []),
    ...(total?.[4] ? [{ label: "Grade", value: total[4] }] : []),
  ];
  const band = [{ label: "Student", value: content.person.name }, { label: content.person.idLabel, value: content.person.idValue }, ...content.fields];
  return (
    <article className={cn(PAGE, "px-[14mm] pt-[12mm] pb-[10mm]")}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2.2mm] bg-[linear-gradient(90deg,#4338ca,#06b6d4,#7c3aed)]" />
      <Stamp status={meta.status} />
      <Letterhead school={content.school} />
      <PillTitle sub={examName}>Examination marksheet</PillTitle>
      <dl className="keep-together mt-5 grid grid-cols-3 gap-2 text-[12px]">
        {band.map((field) => (
          <div key={field.label} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
            <dt className="text-[9.5px] font-semibold tracking-wider text-slate-500 uppercase">{field.label}</dt>
            <dd className="font-semibold break-words text-slate-900">{field.value}</dd>
          </div>
        ))}
      </dl>
      {table ? (
        <table className="mt-5 w-full border-separate border-spacing-0 overflow-hidden rounded-xl text-[12.5px] ring-1 ring-slate-200">
          <thead>
            <tr>
              {table.head.map((cell, index) => (
                <th key={cell} className={cn("bg-indigo-50 px-3 py-2.5 text-[10.5px] font-bold tracking-wider text-indigo-900 uppercase", index > 0 ? "text-right" : "text-left")}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className={index % 2 ? "bg-slate-50/70" : "bg-white"}>
                {row.map((cell, column) => (
                  <td key={column} className={cn("border-t border-slate-100 px-3 py-2", column > 0 ? "text-right tabular-nums" : "font-medium break-words", column === 3 && "font-bold text-slate-900")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {summary.length ? (
        <dl className="keep-together mt-4 flex gap-2">
          {summary.map((tile) => (
            <div key={tile.label} className="flex-1 rounded-xl bg-indigo-50 px-3 py-2.5 text-center ring-1 ring-indigo-100">
              <dt className="text-[9.5px] font-semibold tracking-wider text-indigo-700/70 uppercase">{tile.label}</dt>
              <dd className="text-[16px] font-extrabold text-indigo-900 tabular-nums">{tile.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-3 text-[10.5px] text-slate-500">“Absent” counts as zero and fails the paper; “Exempt” is left out of the total; “—” means no mark is recorded.</p>
      <div className="flex-1" />
      <div className="keep-together mt-10 grid grid-cols-[1fr_auto_1fr] items-end gap-6">
        <Signer name={null} title="Class teacher / Examiner" />
        <SealCircle size="size-[22mm]" />
        <Signer name={content.signatory.name} title={content.signatory.title} src={meta.signatureSrc} />
      </div>
      <Footer content={content} meta={meta} />
    </article>
  );
}

/** The admit card / hall ticket: candidate panel with photo, the paper schedule, signatures. */
function AdmitCardSheet({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const examName = content.title.split(" — ")[1] ?? null;
  const table = content.table;
  const session = content.fields.find((field) => field.label === "Session")?.value ?? null;
  return (
    <article className={cn(PAGE, "overflow-hidden px-[14mm] pt-[12mm] pb-[10mm]")}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2.2mm] bg-[linear-gradient(90deg,#4338ca,#06b6d4,#7c3aed)]" />
      <Stamp status={meta.status} />
      <Watermark />
      <Letterhead school={content.school} />
      <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-3 text-center ring-1 ring-indigo-100">
        <h1 className="text-[17px] font-extrabold tracking-wide text-indigo-800 uppercase">Admit card / Examination hall ticket</h1>
        <p className="text-[12.5px] font-semibold text-indigo-700">{[examName, session].filter(Boolean).join("  ·  ")}</p>
      </div>
      <div className="keep-together mt-4 flex gap-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
        {content.person.photoUrl ? (
          <PersonPhoto person={content.person} className="h-[38mm] w-[30mm] rounded-xl ring-4 ring-white" initialsClass="text-[18pt]" />
        ) : (
          <div className="flex h-[38mm] w-[30mm] shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-2 text-center text-[10px] text-slate-400">Paste a recent photograph</div>
        )}
        <dl className="grid flex-1 grid-cols-2 gap-x-5 gap-y-2.5 text-[12.5px]">
          {[{ label: "Candidate's name", value: content.person.name }, { label: content.person.idLabel, value: content.person.idValue }, ...content.fields.filter((field) => field.label !== "Session")].map((field) => (
            <div key={field.label}>
              <dt className="text-[9.5px] font-semibold tracking-wider text-slate-500 uppercase">{field.label}</dt>
              <dd className="font-bold break-words text-slate-900">{field.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {table ? (
        <>
          <p className="mt-5 text-[12.5px] font-bold text-slate-900">Examination schedule</p>
          <table className="mt-2 w-full border-separate border-spacing-0 overflow-hidden rounded-xl text-[12.5px] ring-1 ring-slate-200">
            <thead>
              <tr>
                {table.head.map((cell) => (
                  <th key={cell} className="bg-indigo-50 px-3 py-2.5 text-left text-[10.5px] font-bold tracking-wider text-indigo-900 uppercase">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className={index % 2 ? "bg-slate-50/70" : "bg-white"}>
                  {row.map((cell, column) => (
                    <td key={column} className={cn("border-t border-slate-100 px-3 py-2.5", column === 2 && "font-semibold text-slate-900", column === 4 && "w-[30mm] border-l border-dashed")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {content.school.footerNote ? <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{content.school.footerNote}</p> : null}
      <div className="flex-1" />
      <div className="keep-together mt-10 grid grid-cols-[1fr_auto_1fr] items-end gap-6">
        <Signer name={null} title="Candidate's signature" />
        <SealCircle size="size-[22mm]" />
        <Signer name={content.signatory.name} title={content.signatory.title} src={meta.signatureSrc} />
      </div>
      <footer className="mt-5 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500">
        <span>Bring this card to every paper.</span>
        <span className="font-mono">{content.person.idValue}</span>
      </footer>
    </article>
  );
}

/** A certificate, letter, TC, admit card or marksheet on an A4 page — the layout that fits the document. */
export function DocumentSheet({ content, meta, type }: { content: DocumentContent; meta: SheetMeta; type?: DocumentType }) {
  if (content.letter) return <LetterSheet content={content} meta={meta} />;
  if (type === "TRANSFER_CERTIFICATE" || content.title === "Transfer certificate") return <TransferCertificateSheet content={content} meta={meta} />;
  if (type === "ADMIT_CARD" || content.title.startsWith("Admit card")) return <AdmitCardSheet content={content} meta={meta} />;
  if (content.table) return <MarksheetSheet content={content} meta={meta} />;
  return <CertificateSheet content={content} meta={meta} />;
}

// -----------------------------------------------------------------------------
// ID cards — ID-1, 85.60 × 53.98 mm, landscape
// -----------------------------------------------------------------------------

type Role = DocumentContent["person"]["kind"];

/** Each role's chip and accent strip; the card itself is the same white, indigo design. Literal classes so Tailwind keeps them. */
const CARD_LOOK: Record<Role, { chip: string; strip: string }> = {
  STUDENT: { chip: "bg-indigo-100 text-indigo-800", strip: "bg-indigo-600" },
  TEACHER: { chip: "bg-sky-100 text-sky-800", strip: "bg-sky-700" },
  PRINCIPAL: { chip: "bg-amber-100 text-amber-800", strip: "bg-amber-600" },
  STAFF: { chip: "bg-teal-100 text-teal-800", strip: "bg-teal-700" },
};

const CARD = "id-card relative isolate flex h-[53.98mm] w-[85.6mm] shrink-0 flex-col overflow-hidden rounded-[3.18mm] bg-white text-slate-900 ring-1 ring-slate-300";

/** Soft shapes behind the card's content (decoration only). */
function CardBackdrop() {
  return (
    <>
      <span aria-hidden className="absolute -top-[10mm] -right-[12mm] -z-10 size-[42mm] rounded-full bg-indigo-50" />
      <span aria-hidden className="absolute -bottom-[14mm] -left-[10mm] -z-10 size-[30mm] rounded-full bg-cyan-50" />
    </>
  );
}

/** The front: emblem and school, photo, name, chips, details, validity and signature line. */
export function IdCard({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const look = CARD_LOOK[content.person.kind];
  const session = content.fields.find((field) => field.label === "Session")?.value ?? null;
  const chips = content.fields.filter((field) => field.label === "Class" || field.label === "Roll no." || field.label === "Designation");
  const details = content.fields.filter((field) => !chips.includes(field) && field.label !== "Session");
  const phone = content.back?.find((row) => /contact|phone/i.test(row.label)) ?? null;
  return (
    <article className={CARD}>
      <CardBackdrop />
      <Stamp status={meta.status} small />
      <header className="flex items-start gap-[2mm] px-[3mm] pt-[2.6mm]">
        <Emblem school={content.school} sizeMm={8.5} variant="tile" />
        <div className="min-w-0 flex-1">
          <p className={cn(content.school.name.length > 40 ? "text-[6.2pt]" : "text-[7.6pt]", "line-clamp-2 leading-[1.1] font-extrabold tracking-tight uppercase")}>{content.school.name}</p>
          {content.school.headerNote ? <p className="truncate text-[4.6pt] font-semibold tracking-wide text-slate-500 uppercase">{content.school.headerNote}</p> : null}
          <p className={cn("mt-[0.5mm] inline-block rounded-[0.8mm] px-[1.2mm] py-[0.2mm] text-[4.4pt] font-bold tracking-[0.12em] uppercase", look.chip)}>{content.title}</p>
        </div>
        {session ? <span className="shrink-0 rounded-[1mm] bg-indigo-100 px-[1.4mm] py-[0.4mm] text-[5pt] font-bold text-indigo-800">{session}</span> : null}
      </header>
      <div className="flex flex-1 gap-[2.6mm] px-[3mm] pt-[1.8mm]">
        <PersonPhoto person={content.person} className="h-[20mm] w-[16mm] rounded-[1.6mm] shadow-[0_0_0_0.5mm_#fff,0_0.5mm_1.5mm_rgb(15_23_42/0.18)]" initialsClass="text-[11pt]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className={cn(nameSize(content.person.name, ["text-[9.6pt]", "text-[8pt]", "text-[7pt]"]), "line-clamp-2 leading-[1.1] font-extrabold tracking-tight break-words")}>{content.person.name}</p>
          <div className="mt-[0.8mm] flex flex-wrap gap-[0.8mm]">
            {chips.map((chip) => (
              <span key={chip.label} className="rounded-[0.8mm] bg-indigo-50 px-[1.2mm] py-[0.3mm] text-[5pt] font-bold text-indigo-800">
                {chip.label === "Roll no." ? `ROLL #${chip.value}` : chip.value}
              </span>
            ))}
          </div>
          <dl className="mt-[1.2mm] grid grid-cols-2 gap-x-[2mm] gap-y-[0.7mm] text-[5.4pt] leading-tight">
            {[{ label: content.person.idLabel, value: content.person.idValue }, ...details, ...(content.back ?? []).filter((row) => row !== phone)].slice(0, 4).map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[4.4pt] tracking-wider text-slate-400 uppercase">{field.label}</dt>
                <dd className={cn("line-clamp-2 font-bold break-words", field.label === "Blood group" ? "text-red-600" : "text-slate-900")}>{field.value}</dd>
              </div>
            ))}
          </dl>
          {phone ? (
            <p className="mt-[0.8mm] flex items-center gap-[0.8mm] truncate text-[5pt] text-slate-600">
              <PhoneIcon className="size-[2mm] shrink-0 text-indigo-600" aria-hidden />
              {phone.value}
            </p>
          ) : null}
        </div>
      </div>
      <footer className="flex items-end justify-between gap-[2mm] px-[3mm] pb-[1.4mm]">
        <div>
          <p className="text-[4.2pt] tracking-wider text-slate-400 uppercase">{content.validUntil ? "Valid till" : "Issued"}</p>
          <p className="text-[5.6pt] font-bold">{content.validUntil ?? formatDate(meta.issuedOn)}</p>
        </div>
        <div className="w-[26mm] text-center">
          <div className="flex h-[4mm] items-end justify-center">
            {meta.signatureSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private image served after an access check
              <img src={meta.signatureSrc} alt="" className="max-h-[4mm] max-w-full object-contain" />
            ) : null}
          </div>
          <p className="truncate border-t border-slate-300 pt-[0.3mm] text-[4.4pt] font-semibold text-slate-500 uppercase">{[content.signatory.name, content.signatory.title].filter(Boolean).join(" · ")}</p>
        </div>
      </footer>
      <div className={cn("h-[1.2mm]", look.strip)} />
    </article>
  );
}

/** The back: the school's contact, the card's dates and details, return instruction. */
export function IdCardBack({ content, meta }: { content: DocumentContent; meta: SheetMeta }) {
  const look = CARD_LOOK[content.person.kind];
  const school = content.school;
  const rows = [...(content.back ?? []), { label: "Issued", value: formatDate(meta.issuedOn) }, ...(content.validUntil ? [{ label: "Valid till", value: content.validUntil }] : [])];
  return (
    <article className={CARD}>
      <CardBackdrop />
      <Stamp status={meta.status} small />
      <div className="flex flex-1 gap-[3mm] px-[3mm] pt-[2.6mm]">
        <div className="flex w-[40mm] shrink-0 flex-col">
          <div className="flex items-center gap-[1.5mm]">
            <Emblem school={school} sizeMm={7} variant="tile" />
            <p className="line-clamp-2 text-[6.2pt] leading-tight font-extrabold tracking-tight uppercase">{school.name}</p>
          </div>
          <p className="mt-[1.6mm] line-clamp-3 text-[5.3pt] leading-snug text-slate-600">{school.address ?? ""}</p>
          {school.phone ? <p className="mt-[0.8mm] text-[5.8pt] font-bold text-indigo-700">{`Tel: ${school.phone}`}</p> : null}
          {school.email ? <p className="truncate text-[5pt] text-slate-500">{school.email}</p> : null}
          <p className="mt-auto mb-[1mm] rounded-[1mm] bg-indigo-50 px-[1.4mm] py-[0.8mm] text-[4.8pt] leading-snug text-indigo-900">{`This card belongs to ${content.person.name}. If found, please return it to the school.`}</p>
        </div>
        <dl className="flex min-w-0 flex-1 flex-col gap-[0.8mm] rounded-[1.6mm] bg-slate-50 p-[1.8mm] text-[5.4pt] leading-tight ring-1 ring-slate-100">
          {rows.slice(0, 5).map((row) => (
            <div key={row.label}>
              <dt className="text-[4.4pt] tracking-wider text-slate-400 uppercase">{row.label}</dt>
              <dd className="line-clamp-2 font-bold break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <footer className="flex items-end justify-between px-[3mm] pb-[1.2mm] pt-[1mm]">
        <span className="font-mono text-[5pt] text-slate-500">{content.person.idValue}</span>
        <div className="w-[24mm] text-center">
          <div className="flex h-[4mm] items-end justify-center">
            {meta.signatureSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private image served after an access check
              <img src={meta.signatureSrc} alt="" className="max-h-[4mm] max-w-full object-contain" />
            ) : null}
          </div>
          <p className="border-t border-slate-300 pt-[0.3mm] text-[4.4pt] font-semibold text-slate-500 uppercase">{content.signatory.title}</p>
        </div>
      </footer>
      <div className={cn("h-[1.2mm]", look.strip)} />
    </article>
  );
}

// -----------------------------------------------------------------------------
// A4 card sheets — cards at actual size, never stretched
// -----------------------------------------------------------------------------

/**
 * Ten ID-1 cards on one A4 page: 2 columns × 5 rows. 2 × 85.60 + 4 mm gutter
 * = 175.2 mm wide, centred (17.4 mm side margins); 5 × 53.98 + 4 × 2 mm =
 * 277.9 mm tall, centred (9.55 mm top and bottom). A dashed cut line runs
 * 1 mm outside each card.
 */
export const CARD_SHEET = { cols: 2, rows: 5, perPage: 10, cardW: 85.6, cardH: 53.98, gapX: 4, gapY: 2 } as const;
const SHEET_LEFT = (210 - (CARD_SHEET.cols * CARD_SHEET.cardW + (CARD_SHEET.cols - 1) * CARD_SHEET.gapX)) / 2;
const SHEET_TOP = (297 - (CARD_SHEET.rows * CARD_SHEET.cardH + (CARD_SHEET.rows - 1) * CARD_SHEET.gapY)) / 2;

export type CardSlot = { content: DocumentContent; meta: SheetMeta; side: "front" | "back" } | null;

/** One A4 page of card slots, in reading order (an empty slot is left blank, with no cut line). */
export function CardSheetPage({ slots, label }: { slots: CardSlot[]; label?: string }) {
  return (
    <section className="a4-page relative mx-auto h-[297mm] w-[210mm] shrink-0 bg-white shadow-sm ring-1 ring-neutral-200" aria-label={label}>
      {slots.slice(0, CARD_SHEET.perPage).map((slot, index) => {
        const col = index % CARD_SHEET.cols;
        const row = Math.floor(index / CARD_SHEET.cols);
        const left = SHEET_LEFT + col * (CARD_SHEET.cardW + CARD_SHEET.gapX);
        const top = SHEET_TOP + row * (CARD_SHEET.cardH + CARD_SHEET.gapY);
        return (
          slot ? (
            <div key={index} className="absolute" style={{ left: left + "mm", top: top + "mm" }}>
              <span aria-hidden className="absolute -inset-[1mm] rounded-[4mm] border border-dashed border-neutral-300" />
              {slot.side === "front" ? <IdCard content={slot.content} meta={slot.meta} /> : <IdCardBack content={slot.content} meta={slot.meta} />}
            </div>
          ) : null
        );
      })}
      {label ? <p className="no-print absolute right-[4mm] bottom-[2mm] text-[8px] text-neutral-400">{label}</p> : null}
    </section>
  );
}

/**
 * Cards laid out on A4 pages. `duplex`: a page of fronts, then the backs on
 * the next page with the columns swapped, so a long-edge double-sided print
 * puts each back behind its front. `pairs`: each row is one card's front and
 * back side by side (five cards a page) — for single-sided printers.
 */
export function cardSheetPages(cards: Array<{ content: DocumentContent; meta: SheetMeta }>, layout: "duplex" | "pairs"): Array<{ slots: CardSlot[]; label: string }> {
  const pages: Array<{ slots: CardSlot[]; label: string }> = [];
  if (layout === "pairs") {
    for (let start = 0; start < cards.length; start += CARD_SHEET.rows) {
      const chunk = cards.slice(start, start + CARD_SHEET.rows);
      pages.push({ slots: chunk.flatMap((card) => [{ ...card, side: "front" as const }, { ...card, side: "back" as const }]), label: "Front | back" });
    }
    return pages;
  }
  for (let start = 0; start < cards.length; start += CARD_SHEET.perPage) {
    const chunk = cards.slice(start, start + CARD_SHEET.perPage);
    pages.push({ slots: chunk.map((card) => ({ ...card, side: "front" as const })), label: "Fronts" });
    const backs: CardSlot[] = Array.from({ length: CARD_SHEET.perPage }, () => null);
    chunk.forEach((card, index) => {
      const row = Math.floor(index / CARD_SHEET.cols);
      const col = index % CARD_SHEET.cols;
      backs[row * CARD_SHEET.cols + (CARD_SHEET.cols - 1 - col)] = { ...card, side: "back" };
    });
    pages.push({ slots: backs, label: "Backs — print on the reverse" });
  }
  return pages;
}

export const DOCUMENT_PRINT_CSS = `
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  .no-print, [data-sonner-toaster] { display: none !important; }
  .print-page { padding: 0 !important; background: #fff !important; gap: 0 !important; }
  .document-sheet, .a4-page { box-shadow: none !important; --tw-ring-shadow: 0 0 #0000 !important; margin: 0 auto !important; break-after: page; }
  /* A hair under 297 mm, so rounding never spills a blank page; a sheet that runs on repeats its margins and frame on every page. */
  .document-sheet { min-height: 296mm !important; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .document-sheet > div { -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .a4-page { height: 296.5mm !important; overflow: hidden; }
  .keep-together, figure, .photo-frame { break-inside: avoid; }
  h1, h2, header { break-after: avoid; }
  .document-sheet:last-child, .a4-page:last-child { break-after: auto; }
  .id-card { box-shadow: none !important; --tw-ring-color: #bbb !important; }
  .zoom-frame { zoom: 1 !important; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
