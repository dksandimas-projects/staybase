import type { Config } from "tailwindcss";
import config from "../hotel.config";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: config.colors.primary,
        "primary-dark": config.colors.primaryDark,
        "primary-light": config.colors.primaryLight,
        "section-bg": config.colors.sectionBg,
        sidebar: config.colors.sidebar
      },
      fontFamily: {
        heading: [config.fonts.heading.name, "serif"],
        body: [config.fonts.body.name, "system-ui", "sans-serif"]
      },
      borderRadius: {
        card: "12px",
        "card-lg": "16px"
      }
    }
  },
  plugins: []
} satisfies Config;
