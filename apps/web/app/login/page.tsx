import { LoginForm } from "./login-form";
import { app, auth } from "@/lib/strings";
import { Logo } from "@/components/logo";

/**
 * Server shell. Next 15 hands `searchParams` in as a Promise, so it is awaited
 * here and the client form receives plain values.
 *
 * Two panels: the brand side states what the tool does, the form side is the
 * only place with an input. The first version was a lone card floating on grey
 * — correct but characterless, and this is the one screen every producer sees
 * every morning.
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
    <main className="auth">
      <section className="auth-brand">
        <div className="auth-brand-inner">
          <Logo size={38} tone="light" />
          <h1 className="auth-headline">
            من المادة العلمية
            <br />
            إلى درس كامل
          </h1>
          <p className="auth-blurb">
            عرض تقديمي، سرد صوتي، فيديو، وبنك أسئلة — من ملف واحد، وكل الملفات على
            خوادمنا.
          </p>

          <ul className="auth-steps">
            <li>
              <span aria-hidden>◫</span> استخراج النص من PDF أو DOCX أو PPTX
            </li>
            <li>
              <span aria-hidden>❖</span> هيكلة الدرس ومراجعته قبل أي إنتاج
            </li>
            <li>
              <span aria-hidden>▶</span> عرض وسرد وفيديو وحزمة جاهزة للتسليم
            </li>
          </ul>
        </div>
      </section>

      <section className="auth-form">
        <div className="auth-form-inner">
          <h2 className="auth-title">{auth.title}</h2>
          <p className="muted" style={{ marginBlockStart: 4, marginBlockEnd: 24 }}>
            {app.name}
          </p>

          <LoginForm next={next} expired={Boolean(params.expired)} />

          <p className="muted" style={{ marginBlockEnd: 0, marginBlockStart: 20 }}>
            {auth.noSignup}
          </p>
        </div>
      </section>
    </main>
  );
}
