import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventList } from "@/features/communication/feed";
import { publicEvents } from "@/server/communication/events";
import { getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Events" };

export default async function PublicEventsPage(props: PageProps<"/schools/[slug]/events">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const events = await publicEvents(school.id, 50);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Events</h1>
      <p className="text-muted-foreground mb-8">What is coming up at {school.name}.</p>
      <EventList events={events} />
    </div>
  );
}
