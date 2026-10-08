import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { normalizePhrase } from "./phrase-translate";

/**
 * Every piece of interface text in the source, for the phrase dictionary.
 *
 * Reads the TypeScript source (no build needed) and collects what a person can
 * see: JSX text, and string literals that read as words — labels, titles,
 * hints, toasts, validation and error messages. Template literals become
 * templates with numbered holes ("Covering for {0} until {1}").
 *
 * Used by `npm run i18n:extract` (to list what needs translating) and by the
 * coverage test, which fails when visible text has no Hindi.
 */

export const PHRASE_ROOTS = ["src/app", "src/features", "src/components", "src/server", "src/lib"];

/** Attributes that never hold visible text. */
const NON_TEXT_ATTRIBUTES = new Set([
  "className", "href", "id", "key", "name", "type", "src", "variant", "size", "tone", "icon", "role", "method", "action",
  "htmlFor", "inputMode", "autoComplete", "lang", "rel", "target", "accept", "pattern", "status", "align", "side", "dir",
  "form", "encType", "prefetch", "as", "fill", "stroke", "viewBox", "d", "transform", "style", "data-slot", "data-state",
]);

const CSS_TOKEN = /\b(flex|grid|text-(?:xs|sm|base|lg|xl|muted|primary|white|center|right|left)|bg-|px-|py-|p-\d|m[trblxy]?-\d|rounded|border|gap-|w-|h-|size-|items-|justify-|font-|tabular|shrink|grow|hidden|block|inline|absolute|relative|overflow|opacity|shadow|ring|hover:|focus|sm:|md:|lg:|xl:)/;
const DIRECTIVES = new Set(["use client", "use server", "server-only"]);

/** A Tailwind class list ("flex items-center gap-2"), not words: lowercase tokens, at least one utility. */
function isClassList(text: string): boolean {
  return CSS_TOKEN.test(text) && text.split(/\s+/).every((token) => /^[!a-z0-9:_\-/[\]().%#,'"=&>*@~]+$/.test(token));
}

/** Whether a string literal reads as words a person sees, not code. */
export function looksLikeText(value: string): boolean {
  const text = value.trim();
  if (!/[A-Za-z]{2}/.test(text) || DIRECTIVES.has(text)) return false;
  if (isClassList(text)) return false;
  if (/^(https?:|mailto:|tel:|\/|@\/|\.\/|#)/.test(text)) return false;
  if (/^[A-Z0-9_]+$/.test(text)) return false; // enum values and constants
  if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(text)) return false; // dotted keys
  if (/^[\w-]+$/.test(text) && /[a-z]/.test(text[0] ?? "")) return false; // single lowercase identifiers
  if (/^[A-Z"'(₹0-9]/.test(text)) return true;
  // Lowercase: only multi-word phrases ("no vehicle assigned", "held, not submitted").
  return /^[a-z][a-z'’,;:]*(\s+[a-zA-Z0-9'’,.;:()·—–-]+){1,}$/.test(text);
}

/** Whether a string sits directly in JSX output — `{n} {one ? "staff" : "staff"}` — where even one lowercase word is visible. */
function renderedInJsx(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    // A child of an element is shown; an attribute value ({variant}) is not.
    if (ts.isJsxExpression(current)) return !!current.parent && (ts.isJsxElement(current.parent) || ts.isJsxFragment(current.parent));
    if (ts.isConditionalExpression(current) || ts.isParenthesizedExpression(current) || (ts.isBinaryExpression(current) && ["||", "??", "&&"].includes(current.operatorToken.getText()))) continue;
    return false;
  }
  return false;
}

function sourceFiles(root: string, dir: string, out: string[]) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated" && entry.name !== "node_modules") sourceFiles(root, rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
}

/** Same as `humanize` in `@/lib/format`: "ON_LEAVE" → "On leave". */
function humanizeEnum(value: string): string {
  const spaced = value.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Every phrase and template in the source under `root` (the project directory). */
export function extractPhrases(root: string): { phrases: string[]; templates: string[] } {
  const files: string[] = [];
  for (const dir of PHRASE_ROOTS) if (fs.existsSync(path.join(root, dir))) sourceFiles(root, dir, files);
  const phrases = new Set<string>();
  const templates = new Set<string>();

  // Enum values reach the screen through `humanize` (status badges, filters): "On leave".
  const schema = path.join(root, "prisma/schema.prisma");
  if (fs.existsSync(schema)) {
    for (const block of fs.readFileSync(schema, "utf8").matchAll(/^enum \w+ \{([^}]*)\}/gm)) {
      for (const line of block[1]!.split("\n")) {
        const value = line.trim().split(/\s/)[0];
        if (value && /^[A-Z][A-Z0-9_]*$/.test(value)) phrases.add(humanizeEnum(value));
      }
    }
  }

  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    // Files that hold sample data, not interface text (a spreadsheet template's
    // example row of names), opt out — a person's name is never translated.
    if (text.includes("i18n-ignore-file")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
      // pluralize(n, "student") → "1 student" / "4 students": both forms as templates.
      if (ts.isCallExpression(node) && node.expression.getText(source) === "pluralize") {
        const [, singular, plural] = node.arguments;
        if (singular && ts.isStringLiteral(singular)) {
          templates.add(`{0} ${singular.text}`);
          templates.add(`{0} ${plural && ts.isStringLiteral(plural) ? plural.text : `${singular.text}s`}`);
        }
      }
      if (ts.isJsxText(node)) {
        const phrase = normalizePhrase(node.text);
        if (/[A-Za-z]{2}/.test(phrase)) phrases.add(phrase);
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const parent = node.parent;
        const attribute = parent && ts.isJsxAttribute(parent) ? parent.name.getText(source) : null;
        // An object key, an import path, a CSS class or a property name is not text.
        const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
        const isIndex = parent && ts.isElementAccessExpression(parent);
        if (!isKey && !isIndex && !(attribute && NON_TEXT_ATTRIBUTES.has(attribute))) {
          if (looksLikeText(node.text) || (renderedInJsx(node) && /^[a-z][a-z'’ ]+$/.test(node.text.trim()) && node.text.trim().length > 1)) phrases.add(normalizePhrase(node.text));
        }
      } else if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
        const joined = parts.map((part, index) => (index === 0 ? part : `{${index - 1}}${part}`)).join("");
        const staticText = parts.join(" ");
        if (/[A-Za-z]{3}/.test(staticText) && !isClassList(staticText.trim()) && !/^(https?:|\/|@\/|\?|#)/.test(parts[0]!.trim())) {
          const template = normalizePhrase(joined);
          // A template that is only holes and punctuation ("{0} · {1}") translates itself.
          if (/[A-Za-z]{2}/.test(template.replace(/\{\d+\}/g, ""))) templates.add(template);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { phrases: [...phrases].sort(), templates: [...templates].sort() };
}
