/**
 * Engosoft mark and wordmark.
 *
 * The mark is SVG so it scales and recolours for a white sidebar or a navy
 * sign-in panel without a second asset. The wordmark is real HTML text, not
 * SVG <text>: inside an RTL document, SVG text picks up the inherited
 * direction and "ENGO" / "SOFT" were rendering out of order with half the
 * word clipped. An LTR-isolated span cannot do that, and it uses the real
 * loaded font rather than whatever the SVG resolves to.
 */

export function Logo({
  size = 30,
  tone = "dark",
  withWordmark = true,
}: {
  size?: number;
  /** "dark" = navy wordmark for light grounds. "light" = white for navy. */
  tone?: "dark" | "light";
  withWordmark?: boolean;
}) {
  const wordColor = tone === "light" ? "#FFFFFF" : "#0D2137";
  const barColor = tone === "light" ? "#FFFFFF" : "#0D2137";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.3,
        // The lockup is a Latin wordmark: it keeps its own order regardless of
        // the surrounding Arabic.
        direction: "ltr",
        unicodeBidi: "isolate",
      }}
      role="img"
      aria-label="Engosoft"
    >
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
        <defs>
          <linearGradient id="eg-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00AEEF" />
            <stop offset="100%" stopColor="#0057B8" />
          </linearGradient>
        </defs>
        {/* Open ring — the counter of a lowercase "e", left open at the lower
            right the way the printed mark is. */}
        <path
          d="M40 24a16 16 0 1 0-6.6 12.9"
          fill="none"
          stroke="url(#eg-ring)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        {/* Crossbar */}
        <path d="M21 24h15" stroke={barColor} strokeWidth="7" strokeLinecap="round" />
        {/* Two dots echoing the mark's lower detail */}
        <circle cx="14" cy="39" r="2.3" fill="#00AEEF" />
        <circle cx="21.5" cy="42.5" r="1.6" fill="#00AEEF" opacity=".55" />
      </svg>

      {withWordmark ? (
        <span
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: size * 0.62,
            letterSpacing: "-0.015em",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: wordColor }}>ENGO</span>
          <span style={{ color: "#0057B8" }}>SOFT</span>
        </span>
      ) : null}
    </span>
  );
}
