---
name: Warm Minimalist Hospitality
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1b1b1b'
  on-surface-variant: '#544335'
  inverse-surface: '#303030'
  inverse-on-surface: '#f1f1f1'
  outline: '#877363'
  outline-variant: '#dac2af'
  surface-tint: '#8d4f00'
  primary: '#8d4f00'
  on-primary: '#ffffff'
  primary-container: '#ea8a1a'
  on-primary-container: '#562e00'
  inverse-primary: '#ffb876'
  secondary: '#575e70'
  on-secondary: '#ffffff'
  secondary-container: '#d9dff5'
  on-secondary-container: '#5c6274'
  tertiary: '#605e5a'
  on-tertiary: '#ffffff'
  tertiary-container: '#a4a19d'
  on-tertiary-container: '#393835'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc0'
  primary-fixed-dim: '#ffb876'
  on-primary-fixed: '#2d1600'
  on-primary-fixed-variant: '#6b3b00'
  secondary-fixed: '#dce2f7'
  secondary-fixed-dim: '#c0c6db'
  on-secondary-fixed: '#141b2b'
  on-secondary-fixed-variant: '#404758'
  tertiary-fixed: '#e6e2dd'
  tertiary-fixed-dim: '#cac6c1'
  on-tertiary-fixed: '#1d1b19'
  on-tertiary-fixed-variant: '#484643'
  background: '#f9f9f9'
  on-background: '#1b1b1b'
  surface-variant: '#e2e2e2'
  primary-hover: '#C4720E'
  primary-light: '#FEF3E2'
  page-bg: '#F9FAFB'
  border-standard: '#E5E7EB'
  text-secondary: '#4B5563'
  status-green-text: '#16A34A'
  status-green-bg: '#F0FDF4'
  status-red-text: '#DC2626'
  status-red-bg: '#FEF2F2'
  status-amber-text: '#D97706'
  status-amber-bg: '#FFFBEB'
  status-gray-text: '#6B7280'
  status-gray-bg: '#F3F4F6'
  status-blue-text: '#2563EB'
  status-blue-bg: '#EFF6FF'
  status-purple-text: '#7C3AED'
  status-purple-bg: '#F5F3FF'
typography:
  display-hero:
    fontFamily: Apollo
    fontSize: 72px
    fontWeight: '400'
    lineHeight: '1.1'
    letterSpacing: 0.05em
  display-hero-mobile:
    fontFamily: Apollo
    fontSize: 44px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  h1:
    fontFamily: Apollo
    fontSize: 40px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  h1-mobile:
    fontFamily: Apollo
    fontSize: 28px
    fontWeight: '400'
    lineHeight: '1.3'
  h2:
    fontFamily: Apollo
    fontSize: 32px
    fontWeight: '400'
    lineHeight: '1.3'
    letterSpacing: 0.05em
  h3:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  h4:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.2'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  touch-target-min: 44px
  sidebar-width: 240px
  drawer-width: 480px
  max-width-auth: 460px
  max-width-booking: 600px
---

## Brand & Style

The design system for **spark inn** is built on a dual-personality framework: "Warm Minimal" for guests and "Efficiency-first" for administration. The brand evokes a sense of boutique premium luxury that is rooted in the natural warmth of Bohol. It avoids aggressive sales tactics in favor of emotional storytelling and high-end service mindsets.

### Visual Style
- **Warm Minimalism (Guest Experience):** Focuses on generous whitespace, large-scale serene imagery, and elegant typography pairings. It utilizes soft shadows and a warm background palette to create a "sanctuary" feel.
- **Efficiency-First (Admin Dashboard):** Prioritizes data density, rapid scannability, and clear information hierarchy. It uses the same brand DNA but shifts towards a more structured, utility-driven layout.
- **Lowercase Branding:** The wordmark "spark inn" remains strictly lowercase to project a modern, approachable, and unassuming luxury.

## Colors

The palette is anchored by **Spark Orange**, used exclusively for interactivity and primary brand moments. 

### Surface Strategy
- **Guest Surface:** Primarily uses `Warm White` (#FDF8F3) to maintain a soft, premium feel.
- **Admin Surface:** Uses `Page Background` (#F9FAFB) for the main content area to reduce eye strain, paired with `Sidebar Dark` (#111827) for high-contrast navigation.
- **Brand Dark:** `Sidebar Dark` is also the primary choice for footers and corporate hero sections.

### Semantic System
Status colors are highly granular to allow administrative staff to scan housekeeping and occupancy status at a glance without reading labels. Always use the defined text/background pairs for accessible contrast.

## Typography

This design system uses a high-contrast font pairing to bridge the gap between editorial luxury and functional utility.

- **Apollo (Serif):** Used for all primary headlines. Headlines are strictly **Sentence case**. Italic variants of Apollo are reserved exclusively for emotional pull-quotes or taglines.
- **Inter (Sans):** Used for all UI elements, body copy, and secondary headings (H3+). It provides the necessary clarity for the Admin Dashboard and functional parts of the Guest App.
- **Formatting:** Apollo requires generous letter-spacing (5-8%) to maintain its premium boutique character.

## Layout & Spacing

The system is built on an **8pt grid**, ensuring mathematical harmony across all components.

### Layout Models
- **Guest App:** Uses a fluid grid with generous safe margins (24px-32px). Content often utilizes a 3-column or 2-column layout on desktop, reflowing to a single column on mobile.
- **Admin Dashboard:** Employs a fixed-width sidebar at 240px with a fluid content area. Data tables and grids are optimized for high information density.
- **Content Constraints:** Specific views like checkout or booking confirmation are constrained to a maximum width (e.g., 600px) to maintain readability and focus.

### Interactive Zones
All buttons, inputs, and clickable list items must adhere to a **44px minimum touch target** height/width to ensure mobile accessibility and a premium, easy-to-use feel.

## Elevation & Depth

Visual hierarchy is managed through a "Tonal Layering" and "Subtle Shadow" approach.

- **Guest App Depth:** Surfaces use soft, diffused shadows with low opacity to lift room cards and booking widgets. Modals utilize a heavy backdrop blur to keep the guest focused on the current task while maintaining a sense of place.
- **Admin Depth:** Elevation is flatter. Subtle borders (`#E5E7EB`) are the primary method of separation. Shadows are used sparingly, primarily for sticky elements like the "Availability Checker Bar" or slide-out drawers.
- **Layering Hierarchy:**
    1. **Base:** Page background.
    2. **Raised:** Room cards, stat cards.
    3. **Overlay:** Navigation bars, sticky summaries.
    4. **Top:** Modals and notifications.

## Shapes

The shape language is defined by the "No Sharp Corners" mandate. Every element is softened to align with the "Warm Minimalist" aesthetic.

- **Interactive Elements:** Buttons and form inputs use a consistent 8px radius.
- **Content Containers:** Standard cards and room cards use a 12px radius.
- **Structural Overlays:** Large modals and containers use a 16px radius.
- **Status Indicators:** All status badges and chips use a pill shape (9999px) to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Spark Orange background, Ember Black or White text. 8px radius. 44px height.
- **Ghost:** Bordered with `#E5E7EB` or Spark Orange. 
- **Hover States:** Use `Primary Hover` (#C4720E) for active orange elements.

### Cards
- **Guest Room Cards:** "Photo before price" philosophy. Large imagery, 12px corner radius, and subtle shadows.
- **Admin Stat Cards:** Flat design with `Secondary Text` (#4B5563) for labels and `Ember Black` for values.

### Inputs & Forms
- 8px border radius.
- Standard border: `#E5E7EB`.
- Active focus/selection: `Spark Orange` (#EA8A1A) 2px border.

### Navigation & Logos
- **Global Nav:** Use `nav-bar-logo.png`.
- **Dark Sections/Sidebar:** Use `FINAL LOGO-white.png`.
- **Standard Light Layouts:** Use `FINAL LOGO.png`.
- **Favicons/Loaders:** Use `ICON LOGO.png`.

### Status Badges
- Strictly pill-shaped.
- Follow the color pairing table in the Colors section to denote occupancy, cleaning status, and payment stages.