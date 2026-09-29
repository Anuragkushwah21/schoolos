import type { Locale } from "@/lib/i18n/config";

import { en, type Messages } from "./en";
import { hi } from "./hi";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, hi };
