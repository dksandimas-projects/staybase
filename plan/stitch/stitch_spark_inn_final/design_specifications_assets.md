# spark inn — Responsive Architecture Map

## Grid & Layout
- **Base Unit:** 8pt grid system for all padding, margins, and component sizing.
- **Desktop (1440px):** 12-column grid, 80px columns, 24px gutters, 120px side margins.
- **Mobile (375px):** 4-column grid, 16px side margins, 16px gutters.
- **Vertical Spacing:**
  - Sections: 120px (Desktop) / 64px (Mobile)
  - Elements: 24px (Standard) / 8px (Tight)

## Scaling Strategy
- **Typography:** Fluid scaling using CSS clamp() or fixed breakpoints. Apollo Display drops from 72px (D) to 44px (M).
- **Navigation:** 
  - Desktop: Horizontal menu + sticky navbar.
  - Mobile: Hamburger menu + slide-out drawer.
- **Cards:** 3-up/4-up on Desktop collapses to 1-up vertical or horizontal carousel on Mobile.
- **Admin Shell:** 240px fixed sidebar on Desktop; hidden hamburger-triggered drawer on Mobile.

## Interactive States
- **Hover:** All Spark Orange (#EA8A1A) CTAs transition to #C4720E on hover (0.2s ease).
- **Active:** 80% opacity + 0.98 scale transform on click/tap.
- **Touch Targets:** Minimum 44px height for all inputs and buttons.

---

# spark inn — Image Asset Catalog

### G-01: Homepage
- **Hero Background:** `{{DATA:IMAGE:PROMPT_G01_HERO}}` - "Cinematic wide-angle shot of a boutique hotel infinity pool overlooking the Bohol jungle at golden hour, 35mm f/2.8, warm tones, high-end travel photography, minimalist luxury aesthetic."
- **Featured Room 1:** `{{DATA:IMAGE:PROMPT_G01_ROOM1}}` - "Boutique hotel bedroom, crisp white linens, warm wood paneling, natural morning light through sheer curtains, minimalist interior design, Bohol Philippines."

### G-02: Rooms Page
- **Ocean View Suite:** `{{DATA:IMAGE:PROMPT_G02_ROOM1}}` - "Luxury hotel suite interior with private balcony, panoramic view of the turquoise Bohol Sea, minimalist furniture, soft warm sunset lighting, f/1.8 shallow depth of field."
- **Standard Deluxe:** `{{DATA:IMAGE:PROMPT_G02_ROOM2}}` - "Modern minimalist hotel room, queen bed, accent wall with tropical greenery, focused lighting, clean lines, premium hospitality photography."

### G-03: Booking Flow
- **Booking Summary Thumb:** `{{DATA:IMAGE:PROMPT_G03_THUMB}}` - "Abstract close-up of high-quality linen texture or a small corner of a minimalist hotel room, soft bokeh, warm white and beige tones."

### G-08: Corporate Stays
- **Corporate Hero:** `{{DATA:IMAGE:PROMPT_G08_HERO}}` - "Modern minimalist lobby lounge with a person working on a laptop, professional yet relaxed atmosphere, high ceilings, natural light, boutique hotel vibe."

---

# spark inn — Component Blueprints

## [G-01] Homepage
- **Navbar:** Sticky, transparent. Logo left, menu center, 'Book Now' orange button right.
- **Hero:** Apollo Display text center, Italic tagline. Secondary ghost button.
- **Room Cards:** 12px radius, image top (2/3), title/price/cta bottom (1/3).

## [A-02] Dashboard Overview
- **Stat Cards:** 12px white card, gray-500 label, black 32px numbers, green/red trend indicators.
- **Room Grid:** Dense 4x4 or 5x5 grid. Each card: Room # bold, small status badge pill. HK toggle icon.
