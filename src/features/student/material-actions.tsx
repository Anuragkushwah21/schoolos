import { DownloadIcon, ExternalLinkIcon, FileTextIcon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * What a student can do with one piece of study material.
 *
 * An uploaded PDF is opened and downloaded only through the download route,
 * which checks the student's own section again; a video or a resource is the
 * teacher's link, opened in a new tab and never fetched by the school.
 */

export const MATERIAL_KIND_LABEL: Record<string, string> = {
  NOTES: "Notes",
  QUESTIONS: "Important questions",
  PRACTICE: "Practice work",
  DOCUMENT: "PDF / document",
  VIDEO: "Video",
  LINK: "Resource",
};

type Material = {
  id: string;
  kind: string;
  url: string | null;
  fileName: string | null;
  fileSize: number | null;
};

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024
    ? ` · ${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : ` · ${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MaterialActions({ material }: { material: Material }) {
  if (material.fileName) {
    const href = `/api/v1/lesson-materials/${material.id}/file`;
    return (
      <>
        <Button asChild size="sm" variant="outline">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <FileTextIcon aria-hidden /> View
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`${href}?download=1`} download={material.fileName}>
            <DownloadIcon aria-hidden /> Download
          </a>
        </Button>
        <span className="text-muted-foreground self-center text-xs">
          {material.fileName}
          {sizeLabel(material.fileSize)}
        </span>
      </>
    );
  }

  if (!material.url) return null;

  const label =
    material.kind === "VIDEO" ? "Watch video" : material.kind === "LINK" ? "Open resource" : "Open document";
  const Icon = material.kind === "VIDEO" ? PlayIcon : ExternalLinkIcon;

  return (
    <Button asChild size="sm" variant="outline">
      <a href={material.url} target="_blank" rel="noopener noreferrer">
        <Icon aria-hidden /> {label}
      </a>
    </Button>
  );
}
