import { getDb } from "@course-prod/core/db";
import { createObjectStore, type ObjectStore } from "@course-prod/core/storage";
import { getWorkerEnv } from "@course-prod/core";

/**
 * Shared per-process handles. The object store is built once because its
 * signing secret and root are fixed for the life of the process.
 */

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  const env = getWorkerEnv();
  store ??= createObjectStore({
    stateDir: env.STATE_DIR,
    // Download URLs are verified by the web service, which signs with
    // SESSION_SECRET — the two must match or every published link 403s.
    secret: process.env.SESSION_SECRET ?? env.SERVICE_KEY,
    publicUrl: env.PUBLIC_URL,
  });
  return store;
}

export { getDb };
