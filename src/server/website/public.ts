import "server-only";

import { cache } from "react";

import { prisma } from "@/server/db/prisma";

/**
 * Read side of a school's public website.
 *
 * The slug in the URL selects which school to *show*; it authorizes nothing.
 * Only ACTIVE schools render, and only fields meant for the public are
 * selected — never the registration contact, subscription or review trail.
 */

export const getPublicSchool = cache(async (slug: string) => {
  return prisma.school.findFirst({
    where: { slug, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      shortName: true,
      about: true,
      principalName: true,
      principalMessage: true,
      establishedYear: true,
      affiliationBoard: true,
      email: true,
      phone: true,
      addressLine: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      logoUrl: true,
      bannerUrl: true,
      primaryColor: true,
      secondaryColor: true,
    },
  });
});

export type PublicSchool = NonNullable<Awaited<ReturnType<typeof getPublicSchool>>>;

export const getPublicPages = cache(async (schoolId: string) => {
  return prisma.schoolPage.findMany({
    where: { schoolId, isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    select: { slug: true, title: true },
  });
});

export async function getPublicPage(schoolId: string, slug: string) {
  return prisma.schoolPage.findFirst({
    where: { schoolId, slug, isPublished: true },
    select: { title: true, body: true, updatedAt: true },
  });
}

export async function getGallery(schoolId: string, take = 12) {
  return prisma.schoolMedia.findMany({
    where: { schoolId, category: "GALLERY" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take,
    select: { id: true, url: true, caption: true },
  });
}

/** Classes a parent may apply for, and streams for senior classes. */
export async function getAdmissionOptions(schoolId: string) {
  const [classes, streams, session] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId, isActive: true },
      orderBy: { level: "asc" },
      select: { id: true, name: true },
    }),
    prisma.stream.findMany({
      where: { schoolId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.academicSession.findFirst({ where: { schoolId, isCurrent: true }, select: { name: true } }),
  ]);
  return { classes, streams, sessionName: session?.name ?? null };
}

/** Only a well-formed hex colour reaches a style attribute. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
