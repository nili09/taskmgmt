import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { email: string } | null) => setEmail(me?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  return (
    <main>
      <h1>Tandem</h1>
      <p>{email ? `Signed in as ${email}.` : "Not signed in."}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
