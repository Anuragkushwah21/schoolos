import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReceiptSettingsForm } from "@/features/finance/forms";
import { requireTenant } from "@/server/auth/current-user";
import { getReceiptSettings } from "@/server/finance/receipts";

export const metadata: Metadata = { title: "Receipt settings" };

/**
 * The school-specific parts of a fee receipt. Name, logo, address and contact
 * details are the school's profile, kept once under Website and read from
 * there, so a receipt can never disagree with the school's own public page.
 */
export default async function ReceiptSettingsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const [settings, school] = await Promise.all([
    getReceiptSettings(ctx),
    ctx.db.school.findFirst({ select: { name: true, logoUrl: true, addressLine: true, city: true, phone: true, email: true } }),
  ]);

  const missing = [
    !school?.logoUrl && "logo",
    !school?.addressLine && !school?.city && "address",
    !school?.phone && !school?.email && "phone or email",
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        back={{ href: "/school-admin/finance/payments", label: "Payments" }}
        title="Receipt settings"
        description="What your school prints on every fee receipt."
      />
      <Card className="mb-6 max-w-3xl">
        <CardHeader>
          <CardTitle>{school?.name}</CardTitle>
          <CardDescription>
            Receipts use your school&apos;s name, logo, address and contact details from the Website profile.
            {missing.length ? ` Not set yet: ${missing.join(", ")}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/school-admin/website">Edit school profile</Link>
          </Button>
        </CardContent>
      </Card>
      <ReceiptSettingsForm settings={settings} />
    </>
  );
}
