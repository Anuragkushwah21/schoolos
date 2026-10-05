/**
 * Merge translated batches into a phrase dictionary.
 *
 *   npx tsx scripts/i18n/merge.ts <dir-of-json-batches> [locale]
 *
 * Each batch is a JSON object { "English": "translation" }. Keys containing
 * {0}-style holes go to `templates`, the rest to `exact`. A translation that
 * invents a hole the English does not have is rejected and listed.
 */
import fs from "node:fs";
import path from "node:path";

const [dir, locale = "hi"] = process.argv.slice(2);
if (!dir) throw new Error("Usage: merge.ts <dir> [locale]");
const root = path.resolve(import.meta.dirname, "../..");
const file = path.join(root, `src/lib/i18n/phrases/${locale}.json`);
const book = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { exact: {}, templates: {} };
const rejected: string[] = [];
let added = 0;

for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
  const batch = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Record<string, string>;
  for (const [from, to] of Object.entries(batch)) {
    if (typeof to !== "string" || !to.trim()) continue;
    const holes = new Set([...from.matchAll(/\{\d+\}/g)].map((match) => match[0]));
    const used = [...to.matchAll(/\{\d+\}/g)].map((match) => match[0]);
    if (used.some((hole) => !holes.has(hole))) {
      rejected.push(`${name}: ${from} → ${to}`);
      continue;
    }
    (holes.size ? book.templates : book.exact)[from] = to;
    added += 1;
  }
}

const sorted = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(file, `${JSON.stringify({ exact: sorted(book.exact), templates: sorted(book.templates) }, null, 1)}\n`);
console.log(`Merged ${added} entries into ${path.relative(root, file)}; rejected ${rejected.length}.`);
for (const line of rejected.slice(0, 50)) console.log(`  rejected: ${line}`);
