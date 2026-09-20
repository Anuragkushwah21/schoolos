import { Fragment } from "react";

import { cn } from "@/lib/utils";

/**
 * Renders the small Markdown subset school admins write in notices and web
 * pages: paragraphs, `#`/`##` headings, `-` lists, `**bold**` and
 * `[links](https://…)`.
 *
 * It builds React elements and never sets HTML, so text containing `<script>`
 * or `onerror=` is shown as the literal characters. Links are allowed only to
 * http(s) and site-relative addresses, which rules out `javascript:` URLs.
 */

function safeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1] !== undefined) {
      nodes.push(<strong key={key}>{match[1]}</strong>);
    } else {
      const href = safeHref(match[3]!);
      nodes.push(
        href ? (
          <a key={key} href={href} className="text-primary underline underline-offset-2" rel="noopener noreferrer nofollow">
            {match[2]}
          </a>
        ) : (
          match[0]
        ),
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function withBreaks(lines: string[], keyPrefix: string): React.ReactNode[] {
  return lines.flatMap((line, i) => [
    ...(i > 0 ? [<br key={`${keyPrefix}-br-${i}`} />] : []),
    <Fragment key={`${keyPrefix}-l-${i}`}>{inline(line, `${keyPrefix}-${i}`)}</Fragment>,
  ]);
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);

  return (
    <div className={cn("flex flex-col gap-3 leading-relaxed", className)}>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        const key = `b${b}`;

        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ""), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]!);
        if (heading && lines.length === 1) {
          const Tag = heading[1]!.length === 1 ? "h2" : "h3";
          return (
            <Tag key={key} className={cn("font-semibold tracking-tight", Tag === "h2" ? "text-xl" : "text-lg")}>
              {inline(heading[2]!, key)}
            </Tag>
          );
        }

        return <p key={key}>{withBreaks(lines, key)}</p>;
      })}
    </div>
  );
}
