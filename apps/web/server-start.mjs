/**
 * Entrypoint for the Next standalone server.
 *
 * Next's generated server.js binds to `process.env.HOSTNAME || '0.0.0.0'`, and
 * in a container HOSTNAME is commonly the container id — so it tries to bind
 * to a name like "a1b2c3d4e5f6", fails DNS resolution, and exits before
 * listening. That failed three Railway deploys with nothing but a healthcheck
 * timeout to show for it.
 *
 * Setting it here rather than in the start command is deliberate. Railway does
 * not run startCommand through a shell — it splits the string into argv — so
 * `HOSTNAME=:: node server.js` is read as a program literally named
 * "hostname=::". A wrapper works the same whether it is launched by a shell,
 * a Dockerfile CMD, or Railway's argv split.
 *
 * `::` binds dual-stack (IPv4 and IPv6). BIND_HOST overrides it if some
 * environment ever needs to be narrower.
 */
process.env.HOSTNAME = process.env.BIND_HOST ?? "::";

// server.js is ESM (the standalone app package.json declares type: module),
// so it has to be imported rather than required.
await import("./server.js");
