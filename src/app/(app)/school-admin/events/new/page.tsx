import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { EventForm } from "@/features/communication/forms";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader back={{ href: "/admin/events", label: "Events" }} title="New event" />
      <EventForm />
    </>
  );
}
