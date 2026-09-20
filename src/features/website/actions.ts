"use server";

import { z } from "zod";

import { type ActionResult, parseFormData, successResult } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { mediaSchema, schoolPageSchema, websiteProfileSchema } from "@/lib/validation/website";
import { requireTenantForAction } from "@/server/auth/current-user";
import {
  addMedia,
  deleteMedia,
  deletePage,
  savePage,
  updateWebsiteProfile,
} from "@/server/website/admin";
import { performAction } from "@/server/perform-action";

type Result = ActionResult<undefined>;
const SITE = ["/admin", "/schools/[slug]"];

export async function updateWebsiteProfileAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await updateWebsiteProfile(ctx, parseFormData(websiteProfileSchema, formData));
      return successResult("School profile saved.");
    },
    { revalidate: SITE },
  );
}

export async function savePageAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await savePage(ctx, parseFormData(schoolPageSchema, formData));
      return successResult("Page saved.");
    },
    { revalidate: SITE, redirectTo: "/admin/website" },
  );
}

export async function deletePageAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { pageId } = parseFormData(z.object({ pageId: id }), formData);
      await deletePage(ctx, pageId);
      return successResult("Page deleted.");
    },
    { revalidate: SITE, redirectTo: "/admin/website" },
  );
}

export async function addMediaAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      await addMedia(ctx, parseFormData(mediaSchema, formData));
      return successResult("Photo added to the gallery.");
    },
    { revalidate: SITE },
  );
}

export async function deleteMediaAction(_p: Result, formData: FormData): Promise<Result> {
  return performAction(
    async () => {
      const ctx = await requireTenantForAction("SCHOOL_ADMIN");
      const { mediaId } = parseFormData(z.object({ mediaId: id }), formData);
      await deleteMedia(ctx, mediaId);
      return successResult("Photo removed.");
    },
    { revalidate: SITE },
  );
}
