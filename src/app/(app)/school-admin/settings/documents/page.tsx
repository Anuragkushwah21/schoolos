import type { Metadata } from "next";
import Link from "next/link";
import { FileBadgeIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentSheet, IdCard, IdCardBack } from "@/features/documents/document-view";
import { DocumentSettingsForm, SignatureForm } from "@/features/documents/forms";
import { ZoomFrame } from "@/features/documents/zoom-frame";
import { DOCUMENTS, DOCUMENT_TYPES } from "@/lib/documents";
import { today } from "@/lib/dates";
import { requireTenant } from "@/server/auth/current-user";
import { documentSamples } from "@/server/documents/service";
import { documentSettings } from "@/server/documents/settings";

export const metadata: Metadata = { title: "Document settings" };

/**
 * The letterhead and signatories used on every certificate, letter and ID
 * card — the school's own, from its profile and these settings. School Admin.
 */
export default async function DocumentSettingsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [settings, samples] = await Promise.all([documentSettings(ctx), documentSamples(ctx)]);
  const preview = { number: null, issuedOn: today(), status: "PREVIEW" as const, signatureSrc: null };
  const prefixes = DOCUMENT_TYPES.filter((type) => DOCUMENTS[type].prefix).map((type) => `${DOCUMENTS[type].prefix} — ${DOCUMENTS[type].label}`);
  return (
    <>
      <PageHeader icon={FileBadgeIcon} tone="blue" back={{ href: "/school-admin/settings", label: "Settings" }} title="Documents & certificates" description="Letterhead and signatories for certificates, letters and ID cards. The school's name, logo, address and phone come from the school profile." />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Letterhead and signatories</CardTitle>
            <CardDescription>
              {`Letterhead: ${settings.name}${settings.addressLine || settings.city ? ` · ${[settings.addressLine, settings.city].filter(Boolean).join(", ")}` : " · no address set"}${settings.logoUrl ? " · with logo" : " · no logo"}. `}
              <Link href="/school-admin/website" className="underline">
                Change the school profile
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentSettingsForm values={settings} />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Principal</CardTitle>
              <CardDescription>{settings.principalName ? `Signs as ${settings.principalName}, Principal.` : "The Principal's name is not set — add it in the school profile (Website)."}</CardDescription>
            </CardHeader>
            <CardContent>
              <SignatureForm who="PRINCIPAL" label="Principal" hasImage={settings.hasPrincipalSignature} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>School Admin / MD</CardTitle>
              <CardDescription>{settings.adminSignatoryName ? `Signs as ${settings.adminSignatoryName}${settings.adminSignatoryTitle ? `, ${settings.adminSignatoryTitle}` : ""}.` : "Set the name on the left to use this signatory."}</CardDescription>
            </CardHeader>
            <CardContent>
              <SignatureForm who="SCHOOL_ADMIN" label="School Admin / MD" hasImage={settings.hasAdminSignature} />
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-xs">A signature image only prints the approved signature; what makes a document official is that an authorised person issued it, which the register records.</p>
          <Card>
            <CardHeader>
              <CardTitle>Document numbers</CardTitle>
              <CardDescription>Issued documents are numbered PREFIX/YEAR/NNNN, counting up each year — for example TC/2026/0001. Generated printouts (ID cards, marksheets) have no number.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
                {prefixes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="mt-8 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">Live preview</h2>
          <p className="text-muted-foreground text-sm">Every document with your letterhead and signatory, filled with sample data so you can check the design. Nothing here is saved or issued. Save the settings above and reload to see changes.</p>
        </div>
        <div className="force-light grid gap-6 rounded-3xl bg-neutral-100 p-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Student ID card", content: samples.studentCard },
            { title: "Teacher ID card", content: samples.teacherCard },
            { title: "Principal ID card", content: samples.principalCard },
            { title: "Staff ID card", content: samples.staffCard },
          ].map((card) => (
            <figure key={card.title} className="flex min-w-0 flex-col gap-2">
              <figcaption className="text-sm font-semibold text-neutral-700">{card.title}</figcaption>
              <ZoomFrame pageWidthMm={85.6}>
                <div className="flex flex-col gap-[4mm]">
                  <IdCard content={card.content} meta={preview} />
                  <IdCardBack content={card.content} meta={preview} />
                </div>
              </ZoomFrame>
            </figure>
          ))}
          {[
            { title: "Bonafide certificate (A4)", content: samples.bonafide, type: "BONAFIDE_CERTIFICATE" as const },
            { title: "Character certificate (A4)", content: samples.character, type: "CHARACTER_CERTIFICATE" as const },
            { title: "Transfer certificate (A4)", content: samples.tc, type: "TRANSFER_CERTIFICATE" as const },
            { title: "Admit card (A4)", content: samples.admitCard, type: "ADMIT_CARD" as const },
            { title: "Marksheet (A4)", content: samples.marksheet, type: "MARKSHEET" as const },
            { title: "Appointment letter (A4)", content: samples.letter, type: "APPOINTMENT_LETTER" as const },
          ].map((sheet) => (
            <figure key={sheet.title} className="flex min-w-0 flex-col gap-2">
              <figcaption className="text-sm font-semibold text-neutral-700">{sheet.title}</figcaption>
              <ZoomFrame pageWidthMm={210}>
                <DocumentSheet content={sheet.content} meta={preview} type={sheet.type} />
              </ZoomFrame>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
