import { useState } from "react";

/* Temporary specimen for the design foundation: it exists to check the
   typeface, the colour, the type scale and the spacing in both appearances.
   The app shell replaces it in the next step. */

const scale = [
  ["Display", "--text-display", 600],
  ["Title", "--text-title", 500],
  ["Lead", "--text-lead", 500],
  ["Body", "--text-body", 400],
  ["Meta", "--text-meta", 400],
  ["Ledger", "--text-ledger", 400],
] as const;

const colours = [
  ["Paper", "--paper", ""],
  ["Ink", "--ink", "17.8 : 1 light, 15.7 : 1 dark"],
  ["Ink muted", "--ink-muted", "6.6 : 1 light, 6.3 : 1 dark"],
  ["Ink faint", "--ink-faint", "4.4 : 1 light, 4.6 : 1 dark"],
  ["Rule", "--rule", "not for text"],
  ["Accent", "--accent", "6.4 : 1 light, 6.1 : 1 dark"],
] as const;

const ledger = [
  ["09:14", "Sajid", "created this task"],
  ["11:02", "Dhiman", "due date 20 Nov → 24 Nov"],
  ["11:48", "Sajid", "owner Dhiman → Sajid"],
  ["14:30", "Dhiman", "added a note"],
] as const;

export default function Foundation() {
  const [forced, setForced] = useState<"light" | "dark" | null>(null);

  function force(next: "light" | "dark" | null) {
    setForced(next);
    if (next) document.documentElement.setAttribute("data-appearance", next);
    else document.documentElement.removeAttribute("data-appearance");
  }

  return (
    <main style={{ maxWidth: "var(--measure)", margin: "0 auto", padding: "var(--space-6) var(--space-4) var(--space-8)" }}>
      <h1 style={{ fontSize: "var(--text-title)", fontWeight: 500, lineHeight: "var(--leading-tight)" }}>Foundation</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "var(--text-meta)", marginTop: "var(--space-2)" }}>
        Newsreader, self-hosted. Appearance follows the device; the buttons force it for this check.
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        {([null, "light", "dark"] as const).map((v) => (
          <button
            key={String(v)}
            onClick={() => force(v)}
            style={{
              minHeight: "var(--touch)",
              padding: "0 var(--space-4)",
              background: "transparent",
              color: forced === v ? "var(--accent)" : "var(--ink)",
              border: "1px solid var(--rule)",
              font: "inherit",
              fontSize: "var(--text-meta)",
            }}
          >
            {v ?? "Device"}
          </button>
        ))}
      </div>

      <Section title="Type scale">
        {scale.map(([name, token, weight]) => (
          <div key={name} style={{ borderTop: "1px solid var(--rule)", padding: "var(--space-3) 0" }}>
            <div style={{ color: "var(--ink-faint)", fontSize: "var(--text-ledger)" }}>
              {name} · var({token})
            </div>
            <div style={{ fontSize: `var(${token})`, fontWeight: weight, lineHeight: "var(--leading-snug)" }}>
              Rebuild the Mumbai basemap
            </div>
          </div>
        ))}
      </Section>

      <Section title="Colour">
        {colours.map(([name, token, ratio]) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              borderTop: "1px solid var(--rule)",
              padding: "var(--space-3) 0",
            }}
          >
            <span style={{ width: "2.5rem", height: "2.5rem", background: `var(${token})`, border: "1px solid var(--rule)" }} />
            <span style={{ flex: 1, fontSize: "var(--text-meta)" }}>{name}</span>
            <span className="tnum" style={{ color: "var(--ink-faint)", fontSize: "var(--text-ledger)" }}>
              {ratio}
            </span>
          </div>
        ))}
      </Section>

      <Section title="History, set as a ledger">
        {ledger.map(([time, who, what]) => (
          <div
            key={time}
            style={{
              display: "grid",
              gridTemplateColumns: "3.5rem 5rem 1fr",
              gap: "var(--space-3)",
              borderTop: "1px solid var(--rule)",
              padding: "var(--space-2) 0",
              fontSize: "var(--text-ledger)",
            }}
          >
            <span className="tnum" style={{ color: "var(--ink-faint)" }}>{time}</span>
            <span style={{ color: "var(--ink-muted)" }}>{who}</span>
            <span>{what}</span>
          </div>
        ))}
      </Section>

      <Section title="What the accent means">
        <p style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--space-3)", fontSize: "var(--text-lead)", lineHeight: "var(--leading-snug)" }}>
          Rebuild the Mumbai basemap
          <span style={{ color: "var(--accent)", fontSize: "var(--text-meta)", marginLeft: "var(--space-3)" }}>Overdue</span>
        </p>
        <p className="tnum" style={{ color: "var(--ink-muted)", fontSize: "var(--text-meta)", marginTop: "var(--space-2)" }}>
          Figures align: 0123456789 · 12 Nov 2026 · 09:14
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: "var(--space-7)" }}>
      <h2 style={{ fontSize: "var(--text-lead)", fontWeight: 500, marginBottom: "var(--space-3)" }}>{title}</h2>
      {children}
    </section>
  );
}
