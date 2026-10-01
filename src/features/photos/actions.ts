"use server";

import { z } from "zod";

import { type ActionResult, runAction, successResult } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { requireTenantForAction } from "@/server/auth/current-user";
import { type PhotoTarget, removePhoto, selfTarget, setPhoto } from "@/server/people/photos";
import { revalidatePath } from "next/cache";

const ROLES = ["SCHOOL_ADMIN", "TEACHER", "STUDENT", "PARENT", "NON_TEACHING_STAFF"] as const;
/** Only ever your own photo: nobody — the School Admin included — changes someone else's. */
const targetSchema = z.object({ owner: z.literal("SELF") });

async function resolveTarget(formData: FormData) {
  const ctx = await requireTenantForAction(...ROLES);
  const parsed = targetSchema.safeParse({ owner: formData.get("owner") });
  if (!parsed.success) throw new ValidationError("You can change only your own photo.");
  const target: PhotoTarget = await selfTarget(ctx);
  return { ctx, target };
}

/** Upload or change your own photo. The service checks it again. */
export async function uploadPhotoAction(_p: ActionResult<{ url: string } | undefined>, formData: FormData): Promise<ActionResult<{ url: string } | undefined>> {
  return runAction(async () => {
    const { ctx, target } = await resolveTarget(formData);
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a photo first.");
    const url = await setPhoto(ctx, target, file);
    revalidatePath("/", "layout");
    return successResult("Photo saved.", { url });
  });
}

export async function removePhotoAction(_p: ActionResult<{ url: string } | undefined>, formData: FormData): Promise<ActionResult<{ url: string } | undefined>> {
  return runAction(async () => {
    const { ctx, target } = await resolveTarget(formData);
    await removePhoto(ctx, target);
    revalidatePath("/", "layout");
    return successResult("Photo removed.", undefined);
  });
}
