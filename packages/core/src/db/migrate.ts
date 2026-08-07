import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { closeDb, getDb } from "./client.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate");
const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsFolder = resolve(here, "../../drizzle");
  log.info("running migrations", { migrationsFolder });
  await migrate(getDb(), { migrationsFolder });
  log.info("migrations complete");
  await closeDb();
}

main().catch(async (e) => {
  log.error("migration failed", { error: e });
  await closeDb();
  process.exit(1);
});
