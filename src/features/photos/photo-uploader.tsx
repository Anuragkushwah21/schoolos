"use client";

import { useActionState, useRef, useState } from "react";
import { CameraIcon } from "lucide-react";

import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";

import { removePhotoAction, uploadPhotoAction } from "./actions";

type Owner = "SELF" | "STUDENT" | "TEACHER" | "STAFF" | "PARENT" | "USER";

/**
 * Upload, preview, change or remove a profile photo. Initials stand in when
 * there is none. JPG, PNG or WebP up to 2 MB — checked again on the server.
 */
export function PhotoUploader({ owner, ownerId, name, url }: { owner: Owner; ownerId?: string; name: string; url: string | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadState, upload, uploading] = useActionState(uploadPhotoAction, { status: "idle" });
  const [removeState, remove, removing] = useActionState(removePhotoAction, { status: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const initials = name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const saved = uploadState.status === "success" ? uploadState.data?.url : undefined;
  const removed = removeState.status === "success";
  const shown = preview ?? (removed ? null : (saved ?? url));
  const message =
    uploadState.status === "error" ? uploadState.message : removeState.status === "error" ? removeState.message : uploadState.status === "success" && !preview ? uploadState.message : removed ? "Photo removed." : null;
  const failed = uploadState.status === "error" || removeState.status === "error";

  return (
    <div className="flex items-center gap-4">
      <div className="bg-primary-soft text-primary-strong relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold">
        {shown ? (
          // A private, authorised URL (or a local preview): next/image cannot fetch it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={`${name}'s photo`} className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initials || "?"}</span>
        )}
        {uploading || removing ? (
          <span className="bg-background/70 absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <form
          action={(formData) => {
            upload(formData);
            setPreview(null);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="owner" value={owner} />
          {ownerId ? <input type="hidden" name="ownerId" value={ownerId} /> : null}
          <input
            ref={input}
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Choose a photo"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
            <CameraIcon aria-hidden />
            {shown ? "Change photo" : "Upload photo"}
          </Button>
          {preview ? (
            <Button type="submit" size="sm" disabled={uploading}>
              Save photo
            </Button>
          ) : null}
        </form>
        {shown && !preview ? (
          <form action={remove}>
            <input type="hidden" name="owner" value={owner} />
            {ownerId ? <input type="hidden" name="ownerId" value={ownerId} /> : null}
            <Button type="submit" variant="ghost" size="xs" disabled={removing}>
              Remove photo
            </Button>
          </form>
        ) : null}
        <p className={`text-xs ${failed ? "text-danger-strong" : "text-muted-foreground"}`} aria-live="polite">
          {message ?? "JPG, PNG or WebP, up to 2 MB."}
        </p>
      </div>
    </div>
  );
}
