"use client";

import { useActionState, useRef, useState } from "react";
import { CameraIcon } from "lucide-react";

import { initialsOf } from "@/components/shared/person-avatar";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { removePhotoAction, uploadPhotoAction } from "./actions";

/**
 * Your own photo as a profile header shows it: a normal-sized avatar with a
 * camera button on its edge. Picking a file previews it in place, with Save
 * and Cancel beside the name; Remove sits there when a photo is set. Whatever
 * is passed as children (name, role, contact) sits to the right.
 */
export function AvatarEditor({ name, url, children, className }: { name: string; url: string | null; children?: React.ReactNode; className?: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadState, upload, uploading] = useActionState(uploadPhotoAction, { status: "idle" });
  const [removeState, remove, removing] = useActionState(removePhotoAction, { status: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // The picked file stays on screen while it uploads, then the saved URL takes over.
  const [sending, setSending] = useState<string | null>(null);
  // Whichever was asked for last — a new photo or none — is what shows.
  const [cleared, setCleared] = useState(false);

  const saved = uploadState.status === "success" ? uploadState.data?.url : undefined;
  const removed = cleared && removeState.status !== "error";
  const shown = preview ?? (uploading ? sending : null) ?? (removed ? null : (saved ?? url));
  const busy = uploading || removing;
  const error = uploadState.status === "error" ? uploadState.message : removeState.status === "error" ? removeState.message : null;
  const done = !preview && !error ? (removed ? "Photo removed." : uploadState.status === "success" ? "Photo saved." : null) : null;

  const cancel = () => {
    setPreview(null);
    if (input.current) input.current.value = "";
  };

  return (
    <div className={cn("flex min-w-0 items-center gap-4", className)}>
      <form
        ref={form}
        action={(formData) => {
          upload(formData);
          setCleared(false);
          setSending(preview);
          setPreview(null);
        }}
        className="relative shrink-0"
      >
        <input type="hidden" name="owner" value="SELF" />
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
        <div className="bg-primary-soft text-primary-strong ring-background flex size-16 items-center justify-center overflow-hidden rounded-full text-lg font-semibold shadow-sm ring-4 sm:size-20 sm:text-xl">
          {shown ? (
            // A private, authorised URL (or a local preview): next/image cannot fetch it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt={`${name}'s photo`} className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initialsOf(name)}</span>
          )}
          {busy ? (
            <span className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-full">
              <Spinner />
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="bg-primary text-primary-foreground ring-background hover:bg-primary/90 focus-visible:ring-ring absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full shadow ring-2 transition-colors focus-visible:outline-none disabled:opacity-60"
          aria-label={shown ? "Change photo" : "Add a photo"}
          title={shown ? "Change photo" : "Add a photo"}
        >
          <CameraIcon className="size-3.5" aria-hidden />
        </button>
      </form>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
          {preview ? (
            <>
              <Button type="button" size="xs" disabled={uploading} onClick={() => form.current?.requestSubmit()}>
                {uploading ? "Saving…" : "Save photo"}
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={uploading} onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <button type="button" className="text-primary font-medium hover:underline" onClick={() => input.current?.click()} disabled={busy}>
                {shown ? "Change photo" : "Add a photo"}
              </button>
              {shown ? (
                <form
                  action={(formData) => {
                    remove(formData);
                    setCleared(true);
                  }}
                  className="contents"
                >
                  <input type="hidden" name="owner" value="SELF" />
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                  <button type="submit" className="text-muted-foreground hover:text-danger-strong font-medium" disabled={busy}>
                    Remove
                  </button>
                </form>
              ) : null}
            </>
          )}
          {error ? <span className="text-danger-strong">{error}</span> : done ? <span className="text-success-strong">{done}</span> : !preview ? <span className="text-muted-foreground">JPG, PNG or WebP · up to 2 MB</span> : null}
        </div>
      </div>
    </div>
  );
}
