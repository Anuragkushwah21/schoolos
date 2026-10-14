/**
 * Printed document layouts, from the rendered markup: physical sizes (ID-1
 * card, A4), how photos, logos and signatures are fitted, long names, the
 * layout chosen per document, and the A4 card-sheet arithmetic.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CARD_SHEET, CardSheetPage, DocumentSheet, IdCard, IdCardBack, cardSheetPages } from "@/features/documents/document-view";
import type { DocumentContent } from "@/lib/documents";

const school: DocumentContent["school"] = { name: "Green Valley Academy", address: "Sector 14, Jaipur", city: "Jaipur", phone: "+91 141 2789100", email: "office@gva.test", logoUrl: null, headerNote: null, footerNote: null, affiliation: null, udiseCode: null };
const meta = { number: null, issuedOn: new Date("2026-10-14"), status: "PREVIEW" as const, signatureSrc: null };
const card = (over: Partial<DocumentContent> = {}, person: Partial<DocumentContent["person"]> = {}): DocumentContent => ({
  title: "Student identity card",
  school,
  person: { kind: "STUDENT", id: "s1", name: "Aarav Verma", idLabel: "Admission no.", idValue: "ADM1", photoUrl: "/api/v1/photos/p1", ...person },
  fields: [{ label: "Class", value: "Class 8 – A" }],
  body: [],
  signatory: { role: "PRINCIPAL", name: "R. Mehta", title: "Principal", hasSignature: false },
  notes: [],
  ...over,
});
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("ID cards", () => {
  it("front and back are both ID-1 landscape, 85.60 × 53.98 mm", () => {
    for (const side of [IdCard, IdCardBack]) {
      const out = html(createElement(side, { content: card(), meta }));
      expect(out).toContain("h-[53.98mm]");
      expect(out).toContain("w-[85.6mm]");
    }
    expect(85.6 / 53.98).toBeCloseTo(1.586, 3);
  });

  it("a photo fills a fixed frame without stretching, anchored near the top; none shows a plain placeholder", () => {
    const out = html(createElement(IdCard, { content: card(), meta }));
    expect(out).toMatch(/class="photo-img size-full object-cover object-\[50%_22%\]"/);
    expect(out).toContain("h-[20mm] w-[16mm]");
    const none = html(createElement(IdCard, { content: card({}, { photoUrl: null }), meta }));
    expect(none).not.toContain("<img");
    expect(none).toContain("No photo");
  });

  it("a logo is contained whole — never cropped to a circle or covered", () => {
    const out = html(createElement(IdCard, { content: card({ school: { ...school, logoUrl: "https://example.test/logo.png" } }), meta }));
    expect(out).toMatch(/<img src="https:\/\/example.test\/logo.png" alt="" class="logo-img h-full max-h-full w-auto max-w-full object-contain"\/>/);
    expect(out).not.toMatch(/logo\.png"[^>]*rounded-full/);
    // With no logo, a plain emblem stands in (titled with the school's initials) — never someone else's logo.
    const none = html(createElement(IdCard, { content: card(), meta }));
    expect(none).toContain('title="GV"');
    expect(none).not.toContain("logo-img");
  });

  it("long names wrap onto two lines at a smaller size instead of being cut off", () => {
    const long = "Venkata Subrahmanya Lakshmi Narasimha Rao";
    const out = html(createElement(IdCard, { content: card({}, { name: long }), meta }));
    expect(out).toContain(long);
    // The smaller size, and the tight line height kept (a size class must not wipe it out).
    expect(out).toMatch(/class="text-\[7pt\] line-clamp-2 leading-\[1.1\] font-extrabold tracking-tight break-words"/);
    expect(html(createElement(IdCard, { content: card({ school: { ...school, name: "Shri Guru Harkrishan Public Senior Secondary School, Jaipur" } }), meta }))).toContain("text-[6.2pt]");
  });

  it("each role gets its own title; the back carries the school's contact and the card's dates", () => {
    const teacher = html(createElement(IdCard, { content: card({ title: "Teacher identity card" }, { kind: "TEACHER" }), meta }));
    expect(teacher).toContain("Teacher identity card");
    const back = html(createElement(IdCardBack, { content: card({ back: [{ label: "Guardian contact", value: "+91 90000 00000 (Father)" }], validUntil: "31 Mar 2027" }), meta }));
    expect(back).toContain("Tel: +91 141 2789100");
    expect(back).toContain("Guardian contact");
    expect(back).toContain("31 Mar 2027");
  });
});

describe("A4 card sheets", () => {
  it("ten cards a page at actual size, every one inside the page", () => {
    const width = CARD_SHEET.cols * CARD_SHEET.cardW + (CARD_SHEET.cols - 1) * CARD_SHEET.gapX;
    const height = CARD_SHEET.rows * CARD_SHEET.cardH + (CARD_SHEET.rows - 1) * CARD_SHEET.gapY;
    expect(width).toBeLessThan(210 - 2 * 10);
    expect(height).toBeLessThan(297 - 2 * 8);
    const out = html(createElement(CardSheetPage, { slots: Array.from({ length: 10 }, () => ({ content: card(), meta, side: "front" as const })) }));
    const lefts = [...out.matchAll(/left:([\d.]+)mm/g)].map((m) => Number(m[1]));
    const tops = [...out.matchAll(/top:([\d.]+)mm/g)].map((m) => Number(m[1]));
    expect(lefts).toHaveLength(10);
    for (const left of lefts) expect(left + CARD_SHEET.cardW).toBeLessThanOrEqual(210);
    for (const top of tops) expect(top + CARD_SHEET.cardH).toBeLessThanOrEqual(297);
    expect(out).toContain("h-[297mm] w-[210mm]");
  });

  it("double-sided: the backs page mirrors the columns so each back lands behind its front", () => {
    const cards = Array.from({ length: 3 }, (_, index) => ({ content: card({}, { name: `Student ${index}` }), meta }));
    const [fronts, backs] = cardSheetPages(cards, "duplex");
    expect(fronts!.slots.map((slot) => slot?.content.person.name ?? null)).toEqual(["Student 0", "Student 1", "Student 2"]);
    expect(backs!.slots.slice(0, 4).map((slot) => slot?.content.person.name ?? null)).toEqual(["Student 1", "Student 0", null, "Student 2"]);
    // Side by side: five cards, front then back on each row.
    const [pairs] = cardSheetPages(cards, "pairs");
    expect(pairs!.slots.map((slot) => slot?.side)).toEqual(["front", "back", "front", "back", "front", "back"]);
    expect(cardSheetPages(Array.from({ length: 23 }, () => ({ content: card(), meta })), "duplex")).toHaveLength(6);
  });
});

describe("A4 documents", () => {
  const certificate = card({ title: "Bonafide certificate", fields: [{ label: "Admission no.", value: "ADM1" }], body: ["This is to certify that Aarav Verma is a bonafide student."] });

  it("every layout is an A4 page, 210 mm wide and at least 297 mm tall", () => {
    const docs: Array<[DocumentContent, string]> = [
      [certificate, "Bonafide"],
      [{ ...certificate, title: "Transfer certificate" }, "TC"],
      [{ ...certificate, title: "Marksheet — Mid-term", table: { head: ["Subject", "Maximum", "Pass mark", "Obtained", "Grade"], rows: [["English", "100", "33", "86", "A2"]], foot: [["Total", "100", "", "86", "A2"]] } }, "Marksheet"],
      [{ ...certificate, title: "Appointment letter", letter: { to: ["Aarav Verma"], subject: "Appointment", acknowledgement: true } }, "Letter"],
      [{ ...certificate, title: "Admit card — Mid-term", table: { head: ["Date", "Day", "Subject", "Max. marks", "Invigilator's initials"], rows: [], foot: [] } }, "Admit card"],
    ];
    for (const [content] of docs) {
      const out = html(createElement(DocumentSheet, { content, meta }));
      expect(out).toContain("min-h-[297mm] w-[210mm]");
    }
  });

  it("each kind of document gets its own layout", () => {
    expect(html(createElement(DocumentSheet, { content: { ...certificate, letter: { to: ["Aarav Verma"], subject: "Appointment as TGT", acknowledgement: true } }, meta }))).toContain("Yours sincerely,");
    expect(html(createElement(DocumentSheet, { content: { ...certificate, title: "Transfer certificate" }, meta }))).toContain("Prepared by");
    expect(html(createElement(DocumentSheet, { content: { ...certificate, title: "Marksheet — Mid-term", table: { head: ["Subject"], rows: [], foot: [] } }, meta }))).toContain("Examination marksheet");
    expect(html(createElement(DocumentSheet, { content: { ...certificate, title: "Admit card — Mid-term", table: { head: ["Date"], rows: [], foot: [] } }, meta, type: "ADMIT_CARD" }))).toContain("Examination schedule");
    expect(html(createElement(DocumentSheet, { content: certificate, meta }))).toContain("School<br/>seal");
  });

  it("a signature image is contained, never stretched; none leaves a blank line; a preview says so", () => {
    const signed = html(createElement(DocumentSheet, { content: certificate, meta: { ...meta, signatureSrc: "/api/v1/documents/d1/signature" } }));
    expect(signed).toMatch(/<img src="\/api\/v1\/documents\/d1\/signature" alt="Signature" class="max-h-14 max-w-\[55mm\] object-contain"\/>/);
    const unsigned = html(createElement(DocumentSheet, { content: certificate, meta }));
    expect(unsigned).not.toContain('alt="Signature"');
    expect(unsigned).toContain("Preview — not issued");
    expect(html(createElement(DocumentSheet, { content: certificate, meta: { ...meta, status: "PENDING_APPROVAL" } }))).toContain("Pending approval — not issued");
    expect(html(createElement(DocumentSheet, { content: certificate, meta: { ...meta, status: "ISSUED", number: "BC/2026/0001" } }))).not.toContain("not issued");
  });

  it("long values wrap rather than overflow, and signing areas never split across pages", () => {
    const out = html(createElement(DocumentSheet, { content: { ...certificate, title: "Transfer certificate", fields: [{ label: "Reason for leaving", value: "A".repeat(180) }] }, meta }));
    expect(out).toContain("font-semibold break-words");
    expect(out).toContain("keep-together");
  });
});
