/**
 * The documents a school produces for its people, in one place — shared by
 * the server (what may be made, for whom, and how) and the pages (labels,
 * which form fields to ask for).
 *
 *   * GENERATED documents are printouts of existing records — ID cards and
 *     marksheets from published results. They carry no official number.
 *   * ISSUED documents are official certificates and letters. Issuing gives
 *     them the school's next number; they can be revoked or superseded, never
 *     edited or deleted.
 */

export type PersonKind = "STUDENT" | "TEACHER" | "STAFF" | "PRINCIPAL";

export const DOCUMENT_TYPES = [
  "STUDENT_ID_CARD",
  "BONAFIDE_CERTIFICATE",
  "CHARACTER_CERTIFICATE",
  "ATTENDANCE_CERTIFICATE",
  "ENROLLMENT_CONFIRMATION",
  "TRANSFER_CERTIFICATE",
  "MARKSHEET",
  "STAFF_ID_CARD",
  "APPOINTMENT_LETTER",
  "EMPLOYMENT_VERIFICATION",
  "EXPERIENCE_CERTIFICATE",
  "RELIEVING_LETTER",
  "SALARY_CERTIFICATE",
  "SERVICE_CERTIFICATE",
  "ADMIT_CARD",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** A form field the issuer fills in — reviewed input, never invented by the system. */
export type DocumentParam = "examId" | "purpose" | "conduct" | "reason" | "leavingDate" | "exitDate" | "admissionDate" | "duesCleared" | "issuedOn";

export type DocumentMeta = {
  label: string;
  for: readonly PersonKind[];
  /** ISSUED: official, numbered. GENERATED: a printout, no number. */
  kind: "ISSUED" | "GENERATED";
  /** Number prefix for issued documents, e.g. "TC" → TC/2026/0001. */
  prefix?: string;
  /** Printed as a credit-card-size card rather than an A4 page. */
  card?: boolean;
  /** Fields the issuer is asked for. */
  params: readonly DocumentParam[];
  /** Only the School Admin, and only with the payroll module. */
  payroll?: boolean;
  /** Employment documents: the School Admin's (the Principal's academic access does not reach them). */
  employment?: boolean;
  hint: string;
};

export const DOCUMENTS: Record<DocumentType, DocumentMeta> = {
  STUDENT_ID_CARD: { label: "Student ID card", for: ["STUDENT"], kind: "GENERATED", card: true, params: [], hint: "Photo, admission number, class and guardian contact. For current students." },
  BONAFIDE_CERTIFICATE: { label: "Bonafide certificate", for: ["STUDENT"], kind: "ISSUED", prefix: "BC", params: ["purpose", "issuedOn"], hint: "Confirms the student studies here this session." },
  CHARACTER_CERTIFICATE: { label: "Character certificate", for: ["STUDENT"], kind: "ISSUED", prefix: "CC", params: ["conduct", "purpose", "issuedOn"], hint: "Conduct as stated by the issuer." },
  ATTENDANCE_CERTIFICATE: { label: "Attendance certificate", for: ["STUDENT"], kind: "ISSUED", prefix: "AC", params: ["purpose", "issuedOn"], hint: "Days attended this session, from the class registers." },
  ENROLLMENT_CONFIRMATION: { label: "Admission / enrollment confirmation", for: ["STUDENT"], kind: "ISSUED", prefix: "EC", params: ["purpose", "issuedOn"], hint: "Admission number, date and current class." },
  TRANSFER_CERTIFICATE: { label: "Transfer certificate (TC)", for: ["STUDENT"], kind: "ISSUED", prefix: "TC", params: ["leavingDate", "admissionDate", "reason", "conduct", "duesCleared", "issuedOn"], hint: "Only for a student who has left (status Transferred, Withdrawn, Graduated or Inactive)." },
  ADMIT_CARD: { label: "Admit card / hall ticket", for: ["STUDENT"], kind: "GENERATED", params: ["examId"], hint: "The examination's papers — dates and subjects — for a current student, printed before the exam." },
  MARKSHEET: { label: "Examination marksheet", for: ["STUDENT"], kind: "GENERATED", params: ["examId"], hint: "From a published examination's results only." },
  STAFF_ID_CARD: { label: "ID card", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "GENERATED", card: true, params: [], hint: "Photo, employee ID and designation. For current employees." },
  APPOINTMENT_LETTER: { label: "Appointment letter", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "APL", employment: true, params: ["issuedOn"], hint: "Designation and joining date from the employee record." },
  EMPLOYMENT_VERIFICATION: { label: "Employment verification", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "EV", employment: true, params: ["purpose", "issuedOn"], hint: "For current employees." },
  EXPERIENCE_CERTIFICATE: { label: "Experience certificate", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "EXP", employment: true, params: ["exitDate", "issuedOn"], hint: "For employees who have left: joining to leaving date." },
  RELIEVING_LETTER: { label: "Relieving letter", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "REL", employment: true, params: ["exitDate", "issuedOn"], hint: "For employees who have left: relieved of duties from their last working day." },
  SERVICE_CERTIFICATE: { label: "Service certificate", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "SRV", employment: true, params: ["purpose", "issuedOn"], hint: "Service period from the employee record — to date, or to the last working day." },
  SALARY_CERTIFICATE: { label: "Salary certificate", for: ["TEACHER", "STAFF", "PRINCIPAL"], kind: "ISSUED", prefix: "SAL", employment: true, payroll: true, params: ["purpose", "issuedOn"], hint: "From the current salary structure. School Admin only." },
};

export function documentLabel(type: string): string {
  return DOCUMENTS[type as DocumentType]?.label ?? type;
}

export function documentsFor(kind: PersonKind): DocumentType[] {
  return DOCUMENT_TYPES.filter((type) => DOCUMENTS[type].for.includes(kind));
}

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** What a document says — kept with the record, so an issued document prints the same later. */
export type DocumentContent = {
  title: string;
  school: { name: string; address: string | null; city?: string | null; phone: string | null; email: string | null; logoUrl: string | null; headerNote: string | null; footerNote: string | null; affiliation: string | null; udiseCode: string | null };
  person: { kind: PersonKind; id: string; name: string; idLabel: string; idValue: string; photoUrl: string | null };
  /** Label–value rows, in order. */
  fields: Array<{ label: string; value: string }>;
  /** The certificate's or letter's own words, paragraph by paragraph. */
  body: string[];
  /** Marksheets: the results table. */
  table?: { head: string[]; rows: string[][]; foot: string[][] };
  /** ID cards: valid until. */
  validUntil?: string | null;
  /** ID cards: the details printed on the back (guardian contact, date of joining). */
  back?: Array<{ label: string; value: string }>;
  /** Letters: who it is addressed to, the subject line, and whether the employee signs an acknowledgement. */
  letter?: { to: string[]; subject: string; acknowledgement?: boolean };
  signatory: { role: "PRINCIPAL" | "SCHOOL_ADMIN"; name: string | null; title: string; hasSignature: boolean };
  /** Shown when something optional is missing — the issuer saw these. */
  notes: string[];
};
