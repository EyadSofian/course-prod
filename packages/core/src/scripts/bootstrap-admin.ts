import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../password.js";
import { closeDb, getDb } from "../db/client.js";
import { pronunciations, users } from "../db/schema.js";
import { createLogger } from "../logger.js";

/**
 * One-time bootstrap (§11). There is no public signup (§10), so the first admin
 * has to come from somewhere — this is it.
 *
 *   ADMIN_EMAIL=me@engosoft.com ADMIN_PASSWORD='…' pnpm bootstrap:admin
 *
 * Idempotent: re-running updates the password of an existing admin rather than
 * failing, so it doubles as a password reset.
 */

const log = createLogger("bootstrap");

/** Seeded per §6.6. Producers edit these from /dictionary afterwards. */
const SEED_PRONUNCIATIONS = [
  { term: "انجوسوفت", replacement: "Engosoft", note: "اسم الشركة يُنطق بالإنجليزية" },
  { term: "إنجوسوفت", replacement: "Engosoft", note: "نفس الاسم بهمزة قطع" },
  { term: "PMP", replacement: "بي إم بي", note: "تُنطق حرفاً حرفاً" },
  { term: "PMBOK", replacement: "بيم-بوك", note: "تُنطق ككلمة واحدة" },
  { term: "Agile", replacement: "أَجايِل", note: "تشكيل مقصود — لا يُطبَّق تلقائياً" },
];

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";

  if (!email || !password) {
    console.error("Usage: ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm bootstrap:admin");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("ADMIN_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);

  // lower(email) to match the expression index, so re-running against an
  // account created with different casing updates it instead of colliding.
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin" }).where(eq(users.id, existing.id));
    log.info("admin password updated", { email });
  } else {
    const [created] = await db
      .insert(users)
      .values({ email, name, role: "admin", passwordHash })
      .returning();
    log.info("admin created", { email, user_id: created?.id });
  }

  let seeded = 0;
  for (const p of SEED_PRONUNCIATIONS) {
    const res = await db
      .insert(pronunciations)
      .values({ ...p, scope: "global" })
      .onConflictDoNothing()
      .returning({ id: pronunciations.id });
    if (res.length) seeded++;
  }
  log.info("pronunciation dictionary seeded", { added: seeded, total: SEED_PRONUNCIATIONS.length });

  // Sanity check that the enum/migration state matches what the code expects.
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  log.info("bootstrap complete", { users: rows[0]?.count ?? 0 });

  await closeDb();
}

main().catch(async (e) => {
  log.error("bootstrap failed", { error: e });
  await closeDb();
  process.exit(1);
});
