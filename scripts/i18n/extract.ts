/**
 * List the interface text that still needs a translation.
 *
 *   npx tsx scripts/i18n/extract.ts [locale]
 *
 * Writes scripts/i18n/missing-<locale>.json: phrases and templates found in
 * the source with no entry in src/lib/i18n/phrases/<locale>.json. Translate
 * those, merge them into the dictionary, and the coverage test passes again.
 */
import fs from "node:fs";
import path from "node:path";

import { extractPhrases } from "../../src/lib/i18n/phrase-extract";

const locale = process.argv[2] ?? "hi";
const root = path.resolve(import.meta.dirname, "../..");
const dictionaryPath = path.join(root, `src/lib/i18n/phrases/${locale}.json`);
const dictionary = fs.existsSync(dictionaryPath) ? JSON.parse(fs.readFileSync(dictionaryPath, "utf8")) : { exact: {}, templates: {} };
const { phrases, templates } = extractPhrases(root);
const missing = {
  exact: phrases.filter((phrase) => !(phrase in dictionary.exact)),
  templates: templates.filter((template) => !(template in dictionary.templates)),
};
fs.writeFileSync(path.join(root, `scripts/i18n/missing-${locale}.json`), `${JSON.stringify(missing, null, 2)}\n`);
console.log(`${phrases.length} phrases, ${templates.length} templates; missing for ${locale}: ${missing.exact.length} phrases, ${missing.templates.length} templates.`);
