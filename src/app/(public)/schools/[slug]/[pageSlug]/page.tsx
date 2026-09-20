import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RichText } from "@/components/shared/rich-text";
import { formatDate } from "@/lib/dates";
import { getPublicPage, getPublicSchool } from "@/server/website/public";

/**
 * One of the school's own pages — About, Academics, Facilities, whatever they
 * have written. Unpublished pages are 404s, like pages that do not exist.
 */
export async function generateMetadata(
  props: PageProps<"/schools/[slug]/[pageSlug]">,
): Promise<Metadata> {
  const { slug, pageSlug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) return {};
  const page = await getPublicPage(school.id, pageSlug);
  return page ? { title: page.title } : {};
}

export default async function SchoolContentPage(props: PageProps<"/schools/[slug]/[pageSlug]">) {
  const { slug, pageSlug } = await props.params;
  const school = await getPublicSchool(slug);
  if (!school) notFound();

  const page = await getPublicPage(school.id, pageSlug);
  if (!page) notFound();

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
      <p className="text-muted-foreground mt-2 text-xs">Updated {formatDate(page.updatedAt)}</p>
      <RichText text={page.body} className="mt-8" />
    </article>
  );
}
