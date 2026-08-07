# Dokie export — Phase 0 capture

**Status: NOT DONE.** Everything below is a template to fill in, not findings.

Dokie's MCP returns a project URL only; it has no export tool (§6.5). This
document records how the file actually comes out, so `HttpExporter` can call
the endpoint directly and the Playwright fallback can be retired.

Until this is filled in:

- `DOKIE_EXPORT_ENDPOINT` in `apps/worker/src/config/dokie-selectors.ts` is
  `null`
- `BrowserExporter` is the only export path
- its selectors are **guesses**, written from what Dokie's UI probably calls
  things — they have never been tested against the real site

---

## How to capture it

Run this with **Claude in Chrome**, which is a discovery instrument driven by a
human in a browser session — never a runtime component (§6.5, §13). Nothing in
the deployed system may depend on it.

1. Log in to dokie.ai.
2. Open a finished project.
3. DevTools → **Network**, filter **Fetch/XHR**, tick **Preserve log**.
4. Click **Export → PPTX**.
5. Find the request that produces the file. It is usually the one whose
   response is either `application/vnd.openxmlformats-...presentationml...`
   or a small JSON body containing a download URL.
6. Right-click it → **Copy → Copy as cURL**, and paste it below.

Repeat for **PDF** if the endpoint differs.

> Redact cookies and bearer tokens before pasting anything into this file. It
> is committed to a public repository. Record *which* header carries auth, not
> its value.

---

## Findings

### Endpoint

| Field | Value |
|---|---|
| URL | `TODO` |
| Method | `TODO` |
| Auth header | `TODO` (name only — never the value) |
| Does the MCP PAT work as the bearer? | `TODO — yes / no (401)` |
| Other required headers | `TODO` |
| Request body | `TODO` |

### Response shape

Tick one:

- [ ] **binary** — the file bytes come back directly
- [ ] **signed-url** — JSON containing a URL to download
- [ ] **async-job** — JSON with a job id, then poll a second endpoint

If not binary, the JSON path to the URL: `TODO` (e.g. `data.download_url`)

If async, the polling endpoint and its terminal states: `TODO`

### Raw cURL (redacted)

```bash
# TODO — paste `Copy as cURL` here, with Cookie and Authorization values removed
```

---

## Wiring it up

Once the table above is filled in, set the export config in
`apps/worker/src/config/dokie-selectors.ts`:

```ts
export const DOKIE_EXPORT_ENDPOINT: DokieExportEndpoint | null = {
  urlTemplate: "https://…/{projectId}/export?format={format}",
  method: "POST",
  headers: { "content-type": "application/json" },
  bodyTemplate: '{"format":"{format}"}',
  responseType: "binary",       // or "signed-url" / "async-job"
  // urlJsonPath: "data.download_url",   // only when not binary
};
```

`selectExporter()` picks `HttpExporter` automatically the moment this is
non-null. No other change is needed, and the browser path stays as a fallback.

**Verify with the self-test rather than a real lesson:**

```bash
curl -s -H "x-service-key: $SERVICE_KEY" http://localhost:3001/self-test | jq
```

Set `DOKIE_SELFTEST_PROJECT_URL` to a finished project first. A `bytes` figure
in the hundreds of kilobytes means the real file came back; anything under
1 KB is caught by the magic-byte check in `exporters/index.ts` and reported as
"probably a login page, not a deck".

---

## DOM selectors (browser fallback)

Fill these in while you have the project open — they are what
`BrowserExporter` matches on, and they are currently guesses.

Controls are matched **by role and accessible name**, never by CSS class (§6.5).
Class names are build artefacts that change without notice; a button that stops
being labelled "export" has stopped being an export button.

| Control | Role | Accessible name (actual text) |
|---|---|---|
| Export trigger | `TODO` | `TODO` |
| PPTX option | `TODO` | `TODO` |
| PDF option | `TODO` | `TODO` |
| Login: email field | `TODO` | `TODO` |
| Login: password field | `TODO` | `TODO` |
| Login: submit | `TODO` | `TODO` |
| Logged-in marker | `TODO` | `TODO` |

Update `DOKIE_SELECTORS` in `apps/worker/src/config/dokie-selectors.ts` — that
one object is the whole surface, so a Dokie redesign is a one-file fix.

---

## Detecting a redesign before a producer does

Run the self-test daily and alert on failure (§6.5). Railway cron, or any
scheduler that can make an authenticated request:

```bash
curl -fsS -H "x-service-key: $SERVICE_KEY" http://course-prodworker.railway.internal:3001/self-test
```

The route already sends a Telegram alert on failure (`kind: selftest_failed`),
so the cron only needs to hit it. The point is timing: without this, the first
sign of a broken exporter is a failed lesson at the worst possible moment.
