import { en, type Messages } from "./messages/en";

/**
 * Translation lookup, shared by server and client.
 *
 * Keys are dot paths into the dictionary ("dashboard.admin.addStudent"), typed
 * so a misspelt key is a compile error. A key missing from a language falls
 * back to English rather than showing the key, so a half-finished translation
 * never leaves a blank button.
 */

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type TranslateVars = Record<string, string | number>;
export type Translator = (key: MessageKey, vars?: TranslateVars) => string;

function lookup(messages: unknown, key: string): string | undefined {
  let node = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function fill(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function createTranslator(messages: Messages): Translator {
  return (key, vars) => fill(lookup(messages, key) ?? lookup(en, key) ?? key, vars);
}

/**
 * Translate a key that is only known at runtime — an enum value such as a
 * status. Returns `fallback` when the dictionary has no entry, so unknown
 * values still read sensibly.
 */
export function translateDynamic(messages: Messages, key: string, fallback: string): string {
  return lookup(messages, key) ?? lookup(en, key) ?? fallback;
}
