export const config = {
  hotelId: "spark-inn",
  brandName: "spark inn",
  rewardsName: "Spark Rewards",
  legalName: "Spark Inn Hotel Corp",
  tagline: "Where comfort is felt, care is intentional, and every stay is consistent.",
  brandPromise: "Peaceful, consistent stays shaped by genuine, intentional hospitality.",
  bookingRefPrefix: "SI",
  memberNumberPrefix: "SR",
  storeName: "Spark Essentials",
  termsLastUpdated: "June 16, 2026",
  colors: {
    primary: "#EA8A1A",
    primaryDark: "#C4720E",
    primaryLight: "#FEF3E2",
    sectionBg: "#FDF8F3",
    sidebar: "#111827"
  },
  fonts: {
    heading: {
      name: "Apollo",
      files: {
        regular: "APOLLO.otf",
        italic: "APOLLOItalic.otf"
      },
      letterSpacing: "0.06em"
    },
    body: {
      name: "Inter",
      source: "google",
      googleFamily: "Inter:wght@400;500;600;700",
      localFile: ""
    }
  },
  logos: {
    standard: "FINAL LOGO.png",
    white: "FINAL LOGO-white.png",
    navbar: "nav-bar-logo.png",
    icon: "ICON LOGO.png",
    wordmark: "TEXT LOGO.png"
  },
  favicon: "ICON LOGO.png",
  currency: "PHP",
  currencySymbol: "₱",
  locale: "en-PH",
  timezone: "Asia/Manila",
  dateFormat: "MMM DD, YYYY",
  phoneCountryCode: "+63",
  dpoEmail: "sparkinn.reservations@gmail.com",
  privacyPolicyLastUpdated: "June 2, 2026",
  applicableLaw: "Republic Act No. 10173 (Data Privacy Act of 2012)",
  pageTitle: "spark inn",
  metaDescription: "Book your stay at spark inn, a boutique hotel in Bohol, Philippines.",
  ogImage: "og-image.png",
  address: {
    street: "J. Borja St",
    city: "Tagbilaran City",
    region: "Bohol",
    postalCode: "6300"
  },
  analyticsId: "",
  whatsappNumber: "",
  frontDeskPhone: "+63-38-000-0000",
  domain: "sparkinnbohol.com",
  adminDomain: "admin.sparkinnbohol.com",
  supportEmail: "sparkinn.dev@gmail.com",
  facebookUrl: "https://www.facebook.com/sparkinnbohol",
  instagramUrl: "https://www.instagram.com/sparkinnbohol"
} as const;

export type HotelConfig = typeof config;
export default config;
