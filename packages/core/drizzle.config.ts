import type { Config } from "drizzle-kit";

export default {
  // Built output, not src: drizzle-kit loads the schema through a CJS bundler
  // that cannot resolve this package's NodeNext-style `../stages.js` imports
  // back to their .ts sources. Run `pnpm --filter @course-prod/core build`
  // before `db:generate` — the db:generate script does it for you.
  schema: "./dist/db/schema.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
