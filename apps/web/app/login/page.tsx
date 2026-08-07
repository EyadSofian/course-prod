import { LoginForm } from "./login-form";
import { app, auth } from "@/lib/strings";

/**
 * Server shell. Next 15 hands `searchParams` in as a Promise, so it is awaited
 * here and the client form receives plain values.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const params = await searchParams;
  // Only same-origin paths — an absolute URL here would be an open redirect.
  const next = params.next?.startsWith("/") ? params.next : "/";

  return (
    <main className="login-wrap">
      <div className="card login-card">
        <h1 style={{ marginBlockEnd: 4 }}>{auth.title}</h1>
        <p className="muted" style={{ marginBlockStart: 0, marginBlockEnd: 20 }}>
          {app.name} — {app.org}
        </p>

        <LoginForm next={next} expired={Boolean(params.expired)} />

        <p className="muted" style={{ marginBlockEnd: 0, marginBlockStart: 16 }}>
          {auth.noSignup}
        </p>
      </div>
    </main>
  );
}
