import { Github } from "lucide-react";
import { useState } from "react";
import { useAdapterContext } from "../../adapters/AdapterContext.jsx";
import { requiresAdapterLogin } from "../../model/auth.js";
import { Spinner } from "../Common/Common.jsx";
import "./AuthenticationGate.scss";

function AuthenticationGate({ children }) {
  const { adapter, session, login } = useAdapterContext();
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState("");

  if (!requiresAdapterLogin(adapter, session)) return children;

  async function signIn() {
    if (authenticating) return;
    setAuthenticating(true);
    setError("");
    try {
      await login();
    } catch (loginError) {
      setError(loginError.message);
      setAuthenticating(false);
    }
  }

  return (
    <main className="authentication-gate">
      <button
        type="button"
        className="authentication-gate__button"
        disabled={authenticating}
        onClick={signIn}
      >
        {authenticating ? <Spinner small /> : <Github size={17} />}
        <span>{authenticating ? "Signing in…" : "Sign in with GitHub"}</span>
      </button>
      {error && (
        <p className="authentication-gate__error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

export { AuthenticationGate };
