-- Each person's own interface language. Nullable and additive: existing
-- accounts keep English until they choose, and nothing else reads it.
ALTER TABLE "User" ADD COLUMN "preferredLanguage" VARCHAR(10);
