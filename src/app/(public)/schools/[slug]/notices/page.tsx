import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NoticeList } from "@/features/communication/feed";
import { publicNotices } from "@/server/communication/notices";
import { getPublicSchool } from "@/server/website/public";

export const metadata: Metadata = { title: "Notices" };

export default async function PublicNoticesPage(props: PageProps<"/schools/[slug]/notices">) {
  const { slug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const notices = await publicNotices(school.id, 50);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Notices</h1>
      <p className="text-muted-foreground mb-8">Public announcements from {school.name}.</p>
      <NoticeList notices={notices} />
    </div>
  );
}
