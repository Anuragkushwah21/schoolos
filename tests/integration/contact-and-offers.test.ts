/**
 * The public side of the platform owner: offers on the homepage, and the
 * contact page that reaches them.
 *
 * Offers: a live one shows, a scheduled one is announced as "coming soon", and
 * switched-off or expired ones show nowhere. Contact: anyone can send a
 * message, it lands in the Super Admin's inbox, bots and floods are turned
 * away, and nobody but a Super Admin can read or handle it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError, RateLimitedError } from "@/lib/errors";
import { inquirySchema } from "@/lib/validation/platform";
import { __resetAllRateLimits } from "@/server/auth/rate-limit";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import {
  countNewInquiries,
  listInquiries,
  setInquiryStatus,
  submitInquiry,
} from "@/server/platform/inquiries";
import { getHomepageCatalogue, getLiveOffers, getUpcomingOffers } from "@/server/platform/marketing";

const PREFIX = "contact-test-";
const DAY = 86_400_000;
let superAdmin: SessionUser;

const actor = (role: SessionUser["role"], id: string): SessionUser => ({
  id,
  email: `${role.toLowerCase()}@${PREFIX}.test`,
  role,
  firstName: "Test",
  lastName: role,
  schoolId: null,
  schoolSlug: null,
  schoolName: null,
  schoolStatus: null,
});

const message = (overrides: Partial<Parameters<typeof submitInquiry>[0]> = {}) => ({
  name: `${PREFIX}Priya`,
  schoolName: "Sunrise Public School",
  email: "priya@example.com",
  phone: "+91 98765 43210",
  city: "Indore",
  topic: "DEMO" as const,
  message: "We have 600 students and would like a demo.",
  ...overrides,
});

async function cleanup() {
  await prisma.platformInquiry.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.platformOffer.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { contains: PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: {
      email: `super@${PREFIX}.test`,
      passwordHash: "not-a-real-hash",
      role: "SUPER_ADMIN",
      firstName: "Platform",
      lastName: "Owner",
    },
  });
  superAdmin = actor("SUPER_ADMIN", user.id);

  const now = Date.now();
  await prisma.platformOffer.createMany({
    data: [
      { title: `${PREFIX}live`, startsAt: new Date(now - DAY), endsAt: new Date(now + 30 * DAY) },
      { title: `${PREFIX}diwali`, startsAt: new Date(now + DAY), endsAt: new Date(now + 40 * DAY) },
      { title: `${PREFIX}far-future`, startsAt: new Date(now + 200 * DAY) },
      { title: `${PREFIX}expired`, startsAt: new Date(now - 60 * DAY), endsAt: new Date(now - DAY) },
      { title: `${PREFIX}switched-off`, startsAt: new Date(now - DAY), isActive: false },
    ],
  });
});

beforeEach(() => __resetAllRateLimits());

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const ours = (rows: Array<{ title: string }>) =>
  rows.map((row) => row.title).filter((title) => title.startsWith(PREFIX));

describe("offers on the homepage", () => {
  it("shows a live offer, and announces one starting soon", async () => {
    expect(ours(await getLiveOffers())).toEqual([`${PREFIX}live`]);
    expect(ours(await getUpcomingOffers())).toEqual([`${PREFIX}diwali`]);

    const catalogue = await getHomepageCatalogue();
    expect(ours(catalogue.offers)).toEqual([`${PREFIX}live`]);
    expect(ours(catalogue.upcoming)).toEqual([`${PREFIX}diwali`]);
  });

  it("moves a scheduled offer to live once its start date passes", async () => {
    const later = new Date(Date.now() + 2 * DAY);
    expect(ours(await getLiveOffers(later))).toContain(`${PREFIX}diwali`);
    expect(ours(await getUpcomingOffers(later))).not.toContain(`${PREFIX}diwali`);
  });
});

describe("the contact form", () => {
  it("stores a message for the Super Admin", async () => {
    const { id } = await submitInquiry(message(), { ipAddress: "10.0.0.1" });
    expect(id).not.toBeNull();

    const { rows, counts } = await listInquiries(superAdmin, { status: "NEW" });
    const row = rows.find((r) => r.id === id)!;
    expect(row).toMatchObject({ schoolName: "Sunrise Public School", topic: "DEMO", status: "NEW" });
    expect(counts.NEW).toBeGreaterThanOrEqual(1);
    expect(await countNewInquiries(superAdmin)).toBeGreaterThanOrEqual(1);
  });

  it("quietly drops a bot that fills the hidden field", async () => {
    const before = await prisma.platformInquiry.count();
    const { id } = await submitInquiry(message({ website: "http://spam.example" }), { ipAddress: "10.0.0.2" });
    expect(id).toBeNull();
    expect(await prisma.platformInquiry.count()).toBe(before);
  });

  it("slows down a flood from one address", async () => {
    for (let i = 0; i < 5; i += 1) await submitInquiry(message(), { ipAddress: "10.0.0.3" });
    await expect(submitInquiry(message(), { ipAddress: "10.0.0.3" })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("requires a name, a valid email and a message", () => {
    const bad = inquirySchema.safeParse({ name: "", email: "not-an-email", topic: "DEMO", message: "" });
    expect(bad.success).toBe(false);
    const fields = bad.success ? [] : bad.error.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["name", "email", "message"]));

    const good = inquirySchema.parse({ name: "A", email: "A@B.COM", topic: "PRICING", message: "Hi" });
    expect(good).toMatchObject({ email: "a@b.com", schoolName: null, phone: null });
  });
});

describe("handling enquiries", () => {
  it("lets the Super Admin mark one contacted, close and reopen it", async () => {
    const { id } = await submitInquiry(message({ name: `${PREFIX}Ravi` }), { ipAddress: "10.0.0.4" });
    await setInquiryStatus(superAdmin, id!, "CONTACTED");
    let row = await prisma.platformInquiry.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe("CONTACTED");
    expect(row.handledAt).not.toBeNull();

    await setInquiryStatus(superAdmin, id!, "NEW");
    row = await prisma.platformInquiry.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({ status: "NEW", handledAt: null });
  });

  it("is Super Admin only", async () => {
    for (const role of ["SCHOOL_ADMIN", "TEACHER", "PARENT", "STUDENT"] as const) {
      await expect(listInquiries(actor(role, "x"))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setInquiryStatus(actor(role, "x"), "any", "CLOSED")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("answers an unknown id as not found", async () => {
    await expect(setInquiryStatus(superAdmin, "missing", "CLOSED")).rejects.toBeInstanceOf(NotFoundError);
  });
});
