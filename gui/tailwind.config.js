/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        success: "hsl(var(--success))",
        // Redesign token layer (`--ac-*`, scoped to `.as-ac` in index.css).
        "ac-bg": "var(--ac-bg)",
        "ac-panel": "var(--ac-panel)",
        "ac-rail": "var(--ac-rail)",
        "ac-raise": "var(--ac-raise)",
        "ac-line": "var(--ac-line)",
        "ac-line2": "var(--ac-line2)",
        "ac-text": "var(--ac-text)",
        "ac-soft": "var(--ac-soft)",
        "ac-muted": "var(--ac-muted)",
        "ac-faint": "var(--ac-faint)",
        "ac-brand": "var(--ac-brand)",
        "ac-brand-tint": "var(--ac-brand-tint)",
        "ac-brand-line": "var(--ac-brand-line)",
        "ac-brand-text": "var(--ac-brand-text)",
        "ac-on-color": "var(--ac-on-color)",
        "ac-info": "var(--ac-info)",
        "ac-info-tint": "var(--ac-info-tint)",
        "ac-info-text": "var(--ac-info-text)",
        "ac-ok": "var(--ac-ok)",
        "ac-ok-tint": "var(--ac-ok-tint)",
        "ac-ok-text": "var(--ac-ok-text)",
        "ac-warn": "var(--ac-warn)",
        "ac-warn-tint": "var(--ac-warn-tint)",
        "ac-warn-text": "var(--ac-warn-text)",
        "ac-alert": "var(--ac-alert)",
        "ac-alert-tint": "var(--ac-alert-tint)",
        "ac-alert-text": "var(--ac-alert-text)",
        "ac-violet": "var(--ac-violet)",
        "ac-violet-tint": "var(--ac-violet-tint)",
        "ac-violet-text": "var(--ac-violet-text)",
      },
      fontFamily: {
        display: ["Anton", "Impact", '"Arial Narrow"', "sans-serif"],
        "ac-mono": ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
