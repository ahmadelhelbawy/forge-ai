/** @type {import('tailwindcss').Config} */
/**
 * FORGE's visual tokens.
 *
 * Graphite, not black: every surface is a step on one cool-grey ramp, so depth
 * comes from luminance and hairline borders rather than shadows. Two accents
 * with separate jobs — `accent` (coolant blue) for focus, selection and
 * ordinary primary actions, and `ember` reserved for the one act FORGE exists
 * for: forging the artifact (Generate, and a brief that is ready for it).
 */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0d11",
          900: "#111419",
          850: "#161a20",
          800: "#1c2128",
          700: "#272d36",
          600: "#39414d",
          500: "#4d5664",
        },
        accent: {
          300: "#9bd0ee",
          400: "#62b0dc",
          500: "#2f7fb0",
          600: "#256a95",
        },
        ember: {
          300: "#ffc996",
          400: "#f5a55b",
          500: "#e8873a",
          600: "#c96d26",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        "rail-flow": { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "24px 0" } },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out both",
        "rail-flow": "rail-flow 900ms linear infinite",
      },
    },
  },
  plugins: [],
};
