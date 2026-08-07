import { eq } from "drizzle-orm";
import { getDb } from "./db/client.js";
import { settings } from "./db/schema.js";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  settingsSchema,
  type Settings,
} from "./settings.js";

/**
 * Database access for settings, kept apart from ./settings.ts so client
 * components can import the schema, rate tables and formatters without
 * dragging the Postgres driver into the browser bundle.
 */

export async function loadSettings(): Promise<Settings> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  if (!row) return DEFAULT_SETTINGS;

  // Merge over defaults so a setting added in a later deploy does not read as
  // undefined for an existing row.
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row.value as object) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(
  patch: Partial<Settings>,
  updatedBy?: string,
): Promise<Settings> {
  const db = getDb();
  const merged = settingsSchema.parse({ ...(await loadSettings()), ...patch });
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: merged, updatedBy })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: merged, updatedBy, updatedAt: new Date() },
    });
  return merged;
}
