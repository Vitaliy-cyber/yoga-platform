/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      /**
       * Z-Index Scale (issue 6):
       * - z-40: Sidebar (desktop navigation)
       * - z-45: MobileNav hamburger button
       * - z-50: CompareBar (fixed at bottom)
       * - z-60: Sheet/Modal overlays
       * - z-61: Sheet/Modal content
       * - z-70: Dialog overlays
       * - z-71: Dialog content
       */
      zIndex: {
        '45': '45',
        '60': '60',
        '61': '61',
        '70': '70',
        '71': '71',
      },
      colors: {
        border: "rgb(var(--border))",
        input: "rgb(var(--input))",
        ring: "rgb(var(--ring))",
        background: "rgb(var(--background))",
        foreground: "rgb(var(--foreground))",
        primary: {
          DEFAULT: "rgb(var(--primary))",
          foreground: "rgb(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary))",
          foreground: "rgb(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive))",
          foreground: "rgb(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "rgb(var(--muted))",
          foreground: "rgb(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "rgb(var(--accent))",
          foreground: "rgb(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "rgb(var(--popover))",
          foreground: "rgb(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "rgb(var(--card))",
          foreground: "rgb(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "sans-serif"],
      },
      // Keyframes and animations are intentionally minimal.
      // Slide animations (slide-in-from-*, slide-out-to-*) are provided
      // by tailwindcss-animate plugin. Custom keyframes (fadeIn, shimmer,
      // etc.) live in globals.css where they need theme-aware styles.
      keyframes: {},
      animation: {},
    },
  },
  plugins: [require("tailwindcss-animate")],
};
