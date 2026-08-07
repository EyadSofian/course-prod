"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";
import { auth } from "@/lib/strings";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary"
      style={{ inlineSize: "100%" }}
      disabled={pending}
    >
      {pending ? auth.submitting : auth.submit}
    </button>
  );
}

export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <>
      {expired ? (
        <div className="alert alert-warn" style={{ marginBlockEnd: 16 }} role="status">
          {auth.expired}
        </div>
      ) : null}

      {state.error ? (
        <div className="alert alert-error" style={{ marginBlockEnd: 16 }} role="alert">
          {state.error}
        </div>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="next" value={next} />

        <div className="field">
          <label htmlFor="email">{auth.email}</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>

        <div className="field">
          <label htmlFor="password">{auth.password}</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <SubmitButton />
      </form>
    </>
  );
}
