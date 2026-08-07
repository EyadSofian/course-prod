import Link from "next/link";
import { redirect } from "next/navigation";
import { endSession, getSession } from "@/lib/session";
import { app, nav } from "@/lib/strings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // The middleware only checks cookie presence; this is where the signature is
  // actually verified.
  if (!session) redirect("/login?expired=1");

  async function signOut() {
    "use server";
    await endSession();
    redirect("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {app.org}
          <div style={{ fontSize: 13, fontWeight: 400, color: "#8fa3b3" }}>{app.name}</div>
        </div>

        <nav aria-label="التنقل الرئيسي">
          <Link href="/">{nav.board}</Link>
          <Link href="/lessons/new">{nav.newLesson}</Link>
          <Link href="/dictionary">{nav.dictionary}</Link>
          <Link href="/settings">{nav.settings}</Link>
        </nav>

        <div className="foot">
          <div className="ltr" style={{ marginBlockEnd: 8 }}>
            {session.email}
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ inlineSize: "100%", fontSize: 13 }}
            >
              {nav.signOut}
            </button>
          </form>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
