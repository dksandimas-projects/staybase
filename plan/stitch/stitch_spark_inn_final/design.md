# spark inn — Stitch Design Spec

> This file is the single source of truth for all Google Stitch mockup prompts.
> Load this at the start of every Stitch session so brand tokens, rules, and screen inventory are in context.

---

## 1. Brand Identity

### Brand Name
- Always written as **spark inn** — all lowercase, no exceptions.

### Colors

| Token | Hex | Usage |
|---|---|---|
| Spark Orange (Primary) | `#EA8A1A` | All primary CTAs, active states, accents, highlights |
| Primary Hover | `#C4720E` | Hover state on orange elements |
| Primary Light | `#FEF3E2` | Selected state backgrounds, badge backgrounds |
| Ember Black | `#000000` | Wordmark, primary body text |
| Warm White | `#FDF8F3` | Alternating section backgrounds on public site |
| Sidebar Dark | `#111827` | Admin dashboard sidebar, footer background |
| Page Background | `#F9FAFB` | Admin dashboard page background (gray-50) |
| Border / Divider | `#E5E7EB` | Table borders, card dividers |
| Secondary Text | `#4B5563` | Labels, captions, secondary copy |
| Primary Text | `#111827` | Headings, body text |

### Status Badge Colors

| Status | Text | Background |
|---|---|---|
| Available / Confirmed | `#16A34A` | `#F0FDF4` |
| Occupied / Cancelled | `#DC2626` | `#FEF2F2` |
| Check-in Today / Warning | `#D97706` | `#FFFBEB` |
| Blocked | `#6B7280` | `#F3F4F6` |
| Pending | `#2563EB` | `#EFF6FF` |
| Checked In | `#EA8A1A` | `#FEF3E2` |
| Checked Out | `#6B7280` | `#F3F4F6` |
| Payment Uploaded | `#7C3AED` | `#F5F3FF` |
| Clean | `#16A34A` | `#F0FDF4` |
| Dirty | `#DC2626` | `#FEF2F2` |
| In Progress (HK) | `#D97706` | `#FFFBEB` |

---

## 2. Typography

| Role | Font | Desktop Size | Mobile Size |
|---|---|---|---|
| Display / Hero | Apollo OTF | 56–72px | 36–44px |
| H1 | Apollo OTF | 40px | 28px |
| H2 | Apollo OTF | 32px | 24px |
| H3 | Inter SemiBold | 24px | 20px |
| H4 | Inter SemiBold | 18px | 16px |
| Body | Inter Regular | 16px | 15px |
| Body Small | Inter Regular | 14px | 13px |
| Label | Inter Medium | 13px | 12px |

- Apollo is the brand heading font (serif-feel, spaced ~0.05–0.08em letter-spacing, sentence case always)
- Apollo Italic: taglines and emotional pull quotes only
- Inter: all UI, body copy, labels, forms, dashboard

---

## 3. Logo Variants

| Variant | File | Use |
|---|---|---|
| Navbar | `nav-bar-logo.png` | Top navigation bar only |
| White (Dark BG) | `FINAL LOGO-white.png` | Hero overlays, footer, admin sidebar |
| Standard (Light BG) | `FINAL LOGO.png` | Default, cards, documents, receipts |
| Icon Only | `ICON LOGO.png` | Favicons, loading states, small formats |

---

## 4. Spacing & Shape Rules

- Border radius — Buttons/inputs: `8px` · Cards: `12px` · Large cards: `16px` · Badges/pills: `9999px`
- Minimum touch target height: `44px` (all form fields and interactive elements)
- Primary CTAs are always Spark Orange (`#EA8A1A`) — no exceptions
- No sharp corners anywhere
- Navbar: sticky, transparent over hero, solid white on scroll / interior pages
- Admin sidebar: always `#111827` with Spark Orange active state indicator

---

## 5. Design Philosophy

**Guest App (Public Website):** Warm Minimal. Boutique hotel premium — not budget, not flashy. Lead with how guests *feel*, not what they get. Never fake urgency ("Book NOW!"). Photo before price, always.

**Admin Dashboard:** Efficiency first. Front desk staff scans, not reads. Clean data hierarchy, zero decorative elements.

---

## 6. Screen Inventory

---

### GUEST APP — Public Website (`www.sparkinnbohol.com`)

---

#### SCREEN G-01: Homepage (`/`)

**Purpose:** Primary conversion entry point. Emotional first impression + availability check above the fold.

**Layout:** Full-width, single column. Sections stack vertically.

**Sections:**
1. **Navbar** — Sticky. Transparent over hero (white text + white logo), transitions to white solid with dark text + orange logo on scroll. Links: Home, Rooms, About, Corporate, Contact, Spark Rewards. Book Now CTA button (Spark Orange).
2. **Hero Section** — Full-viewport height. Background: cinematic hotel photo with dark overlay. Center-aligned. Apollo display heading (white, ~60px). Apollo Italic tagline below. Spark Orange "Check Availability" CTA button. Scroll-down indicator.
3. **Availability Checker Bar** — Directly below hero (sticky or anchored). White card with shadow. Fields: Check-in date, Check-out date, Guests. "Check Availability" orange button. Pre-fills from URL params if navigating from rooms.
4. **Featured Rooms Strip** — 3-up horizontal card grid. Each card: large photo (top), room name (Apollo H3), 2–3 key amenity icons, nightly rate. Orange "View Room" button. Warm White section background (`#FDF8F3`).
5. **Why Spark Inn** — 3-column icon + short copy grid. White background.
6. **Amenities Strip** — Icon grid: WiFi, parking, breakfast option, etc.
7. **Location & Map** — Google Maps embed. Address + contact info beside it.
8. **Footer** — Dark background (`#111827`). White logo. Nav links. Social icons. Copyright + version (`spark inn v0.x.x`).

**Modals/Overlays triggered from this screen:** None — checker navigates to `/book` or `/rooms`.

---

#### SCREEN G-02: Rooms Page (`/rooms`)

**Purpose:** Browse all room types with real-time availability.

**Layout:** Sidebar filters (desktop) / filter drawer (mobile) + room card grid.

**Sections:**
1. **Navbar** — Solid white (no hero on this page)
2. **Page Header** — Apollo H1 "Rooms & Rates", subtext, warm white background
3. **Filter Bar** — Room type dropdown, guest count, date range pickers
4. **Room Grid** — 2-up (desktop) or 1-up (mobile) card grid. Each card:
   - Large photo (top, ~60% of card)
   - Availability badge (top-right corner of photo): Available (green), Occupied (red), etc.
   - Room name (Apollo H3)
   - Bed type + capacity icon row
   - Amenity icon row (3–4 key amenities)
   - Rate per night (right-aligned, orange)
   - "View Details" (ghost) + "Book Now" (orange) buttons
5. **Footer**

**Modals triggered from this screen:**
- **M-01: Room Detail Modal** — Full room info. Large photo carousel (left/top), room details panel (right/bottom): Apollo heading, long description, full amenity list with icons, capacity info, all rate variants (weekday / weekend / with breakfast), CTA: "Book This Room" (orange).

---

#### SCREEN G-03: Booking Flow — Step 1: Select Dates & Room (`/book` — Step 1)

**Purpose:** Date selection + room selection with live availability.

**Layout:** Full page. Step indicator (1 of 4) at top. Two-column on desktop (filters left, room grid right). Single column mobile.

**Elements:**
- Step progress bar — 4 steps, Step 1 active (orange)
- Check-in / Check-out date pickers (disabled past dates, min 1 night enforced)
- Guest count input (number spinner)
- Room type filter tabs or dropdown
- Available rooms grid — same card layout as G-02 but no separate View Details
- Each room card shows two selectable options (radio/toggle): "Room Only" vs "Room + Breakfast" (if breakfast is enabled), combined nightly rate shown
- Rate per night + computed total nights displayed on each card
- "Select" orange button on each card — selecting locks it with orange border + checkmark
- Sticky "Continue to Step 2" orange CTA at bottom (disabled until room selected)

---

#### SCREEN G-04: Booking Flow — Step 2: Guest Details (`/book` — Step 2)

**Purpose:** Collect guest information.

**Layout:** Two-column desktop (form left, booking summary card right). Single column mobile.

**Elements:**
- Step progress bar — Step 2 active
- **Booking Summary Card** (right panel, sticky on desktop): Room photo thumbnail, room name, dates, nights, guests, rate breakdown, total. Read-only.
- **Form fields:**
  - First Name (required)
  - Last Name (required)
  - Email (required)
  - Phone Number (required)
  - Number of Guests (required)
  - Special Requests (optional textarea)
  - Privacy consent checkbox — "I agree to the Privacy Policy and consent to the collection of my personal data." Link opens `/privacy` in new tab. Required to proceed.
- Back button (ghost) + "Continue to Step 3" orange button (disabled until consent checked)
- Inline validation errors per field shown on blur

---

#### SCREEN G-05: Booking Flow — Step 3: Review & Pay (`/book` — Step 3)

**Purpose:** Final review before submitting + payment instruction + proof upload.

**Layout:** Two-column desktop (review + payment left, summary right). Single column mobile.

**Elements:**
- Step progress bar — Step 3 active
- **Booking Summary Card** (right panel) — Room, dates, breakdown, subtotal, discount applied, voucher discount, total
- **Voucher input** — text field + "Apply" button. Success state (green check + discount line item), error state (red message)
- **Senior/PWD discount toggle** — checkbox with label (if applicable)
- **Payment Method selector** — radio cards: GCash, Maya, Bank Transfer, Pay on Arrival. Selected card has orange border.
- **QR / bank details** — shown conditionally based on selected payment method
- **Payment proof upload** — drag-and-drop area or file input (image upload). Preview thumbnail after upload. "Upload Payment Screenshot" label. Required for GCash/Maya/Bank.
- Back button + "Confirm Booking" orange button (disabled until required fields complete)

---

#### SCREEN G-06: Booking Confirmation (`/book/confirm` — Step 4)

**Purpose:** Celebration + booking reference delivery. Last impression = warmth.

**Layout:** Centered, single column. Max-width ~600px. Warm White background.

**Elements:**
- Large animated checkmark / success icon (orange)
- Apollo H1: "You're all set!" or "Your booking is confirmed."
- Booking reference code (large, monospace, styled prominently)
- Summary table: Room, dates, guests, total, payment method
- "Add to Calendar" button (ghost, calendar icon)
- Note about payment review (if payment proof uploaded)
- "Return to Homepage" orange button
- Email confirmation notice ("A confirmation has been sent to your email.")
- Footer

---

#### SCREEN G-07: My Booking Lookup (`/my-booking`)

**Purpose:** Allow guests to retrieve their booking without an account.

**Layout:** Centered card, max-width ~500px. Warm White page background.

**Elements:**
- Apollo H1 "Find My Booking"
- Booking Reference input (required)
- Email input (required)
- "Find Booking" orange button
- Error state: inline message if not found
- **Results state** (below or replaces form): Booking summary card — room photo, room name, dates, guests, status badge, total, payment status. "Need help?" link.

---

#### SCREEN G-08: Corporate Stays Marketing Page (`/corporate`)

**Purpose:** Marketing page to convert corporate clients. CTA leads to inquiry form or corporate booking.

**Layout:** Full-width, section-stacked. Dark header section.

**Sections:**
1. **Navbar** (transparent over dark hero)
2. **Dark Hero Section** — `#111827` background, white Apollo headline, Apollo Italic tagline, two CTAs: "Book with Corporate Rate" (orange) + "Submit an Inquiry" (ghost white)
3. **Benefits Grid** — 3-column: negotiated rates, group bookings, dedicated account manager, flexible billing
4. **How It Works** — numbered steps (simple, clean)
5. **CTA Banner** — orange background, white text, "Get in Touch" button
6. **Footer**

---

#### SCREEN G-09: Corporate Booking — Access Code Gate (`/corporate/book` — Access Gate)

**Purpose:** Validates the corporate access code before revealing the booking flow.

**Layout:** Centered card on dark/neutral background.

**Elements:**
- spark inn logo
- Apollo H2 "Corporate Booking"
- Short description
- Access Code input field (required)
- "Proceed" orange button
- Error state: "Invalid or expired access code."
- On success: transitions to full 4-step booking flow (same as G-03 through G-06) with corporate skin

**Corporate Booking Flow difference from standard:**
- Persistent rate badge showing locked corporate rate
- Dark header treatment
- Company Name field added to Step 2 guest details
- Additional corporate fields: Designation, Company Address, No. of Rooms, Purpose of Stay, Preferred Billing

---

#### SCREEN G-10: Spark Rewards Landing Page (`/rewards`)

**Purpose:** Loyalty program marketing. Sign up + sign in CTAs.

**Layout:** Full-width, section-stacked.

**Sections:**
1. **Hero** — Apollo headline "Earn Every Stay", tagline, two CTAs: "Join Spark Rewards" (orange) + "Sign In" (ghost)
2. **How It Works** — 3-step earn/redeem explainer
3. **Member Perks Grid** — points on every stay, member-only discounts, exclusive offers
4. **CTA Banner** — "Start earning today" + "Create Account" orange button
5. **Footer**

---

#### SCREEN G-11: Sign In (`/signin`)

**Purpose:** Member login for Spark Rewards.

**Layout:** Centered card, max-width ~420px.

**Elements:**
- spark inn logo (standard)
- Apollo H2 "Welcome back"
- Email input
- Password input (show/hide toggle)
- "Sign In" orange button
- "Forgot password?" link
- Divider: "Don't have an account?"
- "Create Account" ghost/link button → `/signup`

---

#### SCREEN G-12: Sign Up (`/signup`)

**Purpose:** New member registration for Spark Rewards.

**Layout:** Centered card, max-width ~460px.

**Elements:**
- spark inn logo
- Apollo H2 "Join Spark Rewards"
- First Name, Last Name
- Email
- Password + Confirm Password
- Phone Number
- Privacy consent checkbox
- "Create Account" orange button
- "Already a member? Sign In" link

---

#### SCREEN G-13: Member Profile (`/account/profile`)

**Purpose:** Manage personal account details.

**Layout:** Sidebar nav (left) + content area (right). Sidebar links: Profile, My Stays, My Rewards.

**Elements:**
- User avatar / initials circle (orange background)
- Member since badge
- Points balance pill (Spark Orange)
- Editable fields: First Name, Last Name, Phone
- Email (read-only)
- "Save Changes" orange button

---

#### SCREEN G-14: My Stays (`/account/stays`)

**Purpose:** Booking history for logged-in members.

**Layout:** Sidebar nav + content area.

**Elements:**
- "My Stays" heading
- Past bookings list — each item: room photo thumbnail, room name, dates, status badge, points earned, "View Details" link
- Empty state illustration + "No stays yet. Book your first stay!" CTA

---

#### SCREEN G-15: My Rewards (`/account/rewards`)

**Purpose:** Points balance, history, and redemption.

**Layout:** Sidebar nav + content area.

**Elements:**
- Large points balance display (orange, Apollo font)
- Points breakdown / history table: Date, Activity, Points ± 
- "How to Redeem" info section
- Empty state for no history

---

#### SCREEN G-16: Intercom / Guest Chat (`/intercom/:roomId`)

**Purpose:** In-room QR chat with hotel staff. Accessed by scanning room QR code.

**Layout:** Full-screen mobile-first chat UI.

**Elements:**
- **Header bar** — spark inn logo, Room number badge (e.g., "Room 102"), online indicator
- **Chat thread** — WhatsApp-style bubbles. Guest messages: right-aligned, orange bubble. Staff messages: left-aligned, white bubble with gray border.
- **Quick Request Panel** — horizontal scroll row of quick-tap buttons (e.g., "Extra Towels", "Room Service", "Housekeeping") above the text input. Each is a pill chip.
- **Message input bar** — text field + send button (orange arrow icon)
- **Spark Essentials store tab** (if store is enabled) — tab or floating button to open product catalog panel
- Store Panel (slide-up): product grid (photo, name, price), add to cart, cart total, "Place Order" orange button, payment options

---

#### SCREEN G-17: About Us (`/about`)

**Purpose:** Brand story, mission, team. Static marketing page.

**Sections:** Hero with brand imagery, Our Story prose section, Mission statement, Hotel photos grid, Footer.

---

#### SCREEN G-18: Contact Us (`/contact`)

**Purpose:** Contact info + inquiry form.

**Sections:** Navbar, Apollo H1 "Say Hello", Contact details (phone, email, address), Google Maps embed, Simple contact form (Name, Email, Message, Send button), Footer.

---

#### SCREEN G-19: 404 Page (`*`)

**Purpose:** Friendly lost-guest experience.

**Elements:** Centered. Apollo H1. Illustration or large icon. Short copy. "Go Home" orange button.

---

### GUEST APP — Modals & Overlays

---

#### MODAL M-01: Room Detail Modal
Triggered from: G-02 Rooms Page "View Details"
Full-screen on mobile, large centered modal on desktop.
Left/top: photo carousel. Right/bottom: room name (Apollo H2), description, amenity list with icons, bed type, capacity, rate table (weekday / weekend / with breakfast). CTA: "Book This Room" orange button. X close button.

---

#### MODAL M-02: Availability Filter Drawer (Mobile)
Triggered from: G-02 filter bar on mobile.
Bottom sheet slide-up. Date range pickers + guest count + room type filter + "Apply Filters" orange button.

---

#### MODAL M-03: Corporate Access Code Gate
Described in G-09 above.

---

#### MODAL M-04: Voucher Input (inline in Step 3)
Inline expand — not a modal. Text field + Apply button. Success: green badge + discount line item. Error: red text.

---

### ADMIN APP — Dashboard (`admin.sparkinnbohol.com`)

All admin screens share a persistent shell:
- **Sidebar** (`240px`, `#111827` dark, Spark Orange active indicator, spark inn white logo top, version bottom)
- **Main content area** (`#F9FAFB` gray-50 background)
- Sidebar nav links: Dashboard, Bookings, Rooms, Rates (Admin only), Reports, Corporate, Intercom, QR Codes, Members (Admin only), Settings (Admin only)

---

#### SCREEN A-01: Admin Login (`/login`)

**Purpose:** Staff authentication. No public registration.

**Layout:** Split: left brand panel (dark, `#111827`, white logo, tagline), right login form panel.

**Elements:**
- Apollo H2 "Staff Portal"
- Email input
- Password input (show/hide toggle)
- "Sign In" orange button
- Error state: inline red message for invalid credentials
- No "Forgot Password" link visible (admin-managed accounts)

---

#### SCREEN A-02: Dashboard Overview (`/`)

**Purpose:** At-a-glance hotel status. Primary screen for front desk.

**Layout:** Sidebar + content. Content: stat cards row + occupancy chart + room grid.

**Elements:**
- **Stat Cards Row** (4 cards): Today's Check-ins, Today's Check-outs, Currently Occupied, Total Rooms. Each: label, large number, optional trend arrow.
- **Occupancy Bar Chart** (Recharts) — 7-day or 30-day occupancy % view. Tab toggle.
- **Room Status Grid** — card per room. Each card: Room number (bold), room type label, status badge (Available / Occupied / Checked In / Blocked / etc.), housekeeping status badge, HK toggle button (quick-tap: Clean → Dirty → In Progress). Clicking a room card opens Booking Detail Drawer (if occupied) or quick action options.

---

#### SCREEN A-03: Bookings Management (`/bookings`)

**Purpose:** Full booking table with filters, search, and status management.

**Layout:** Sidebar + content. Content: filter/search bar + data table.

**Elements:**
- **Filter bar:** Search (ref / name / email), Status filter dropdown, Date range filter, Room type filter
- **Bookings Table:** Columns: Ref, Guest Name, Room, Check-in, Check-out, Guests, Total, Status Badge, Payment Status, Actions. Row click → opens Booking Detail Drawer.
- Table has loading skeleton rows (never blank)
- **"+ Walk-in Booking" orange button** (top right) → opens Walk-in Modal

**Drawers/Modals triggered from this screen:**
- **D-01: Booking Detail Drawer** — right-side slide-in panel
- **M-05: Walk-in Booking Modal**

---

#### DRAWER D-01: Booking Detail Drawer

Full-height right drawer (~480px wide, 100% height).

**Contents:**
- Booking ref badge
- Status badge (with dropdown to change status — allowed transitions only)
- Guest info section: name, email, phone
- Stay details: room, check-in, check-out, nights, guests
- Breakfast selection: has breakfast indicator, silog selection UI (if applicable) — dropdown or button group per day
- Rate breakdown: room rate × nights, breakfast rate, discounts, voucher, total
- Payment section: method, payment status badge, "View Payment Proof" button (admin only — opens image in lightbox), payment log (date, amount, method, note)
- "Add Onsite Payment" inline form: amount, method, note, Submit button
- Special requests box (read-only)
- Booking timeline / status change log
- "Generate Receipt" orange button (triggers PDF download)
- "Cancel Booking" danger button (with confirmation prompt)

---

#### MODAL M-05: Walk-in Booking Modal

Large centered modal. Multi-step or single long form.

**Fields:**
- Room selector (dropdown of available rooms for selected dates)
- Check-in / Check-out date pickers
- Guest count
- Breakfast option toggle (Room Only / Room + Breakfast)
- First Name, Last Name, Email, Phone
- Payment method (radio cards)
- Amount received (if Pay on Arrival)
- Special requests
- "Create Booking" orange button

---

#### SCREEN A-04: Room Management (`/rooms`)

**Purpose:** Edit room details, photos, status, and block reasons.

**Layout:** Sidebar + content. Room list/grid on left or top, edit panel on right or below.

**Elements:**
- Room list: each row shows room number, type, status badge, photo thumbnail
- "Edit" button per room → opens Room Edit Drawer
- Room status toggle: Available / Blocked (with block reason input)

**Drawers triggered:**
- **D-02: Room Edit Drawer**

---

#### DRAWER D-02: Room Edit Drawer

Right-side drawer.

**Contents:**
- Room Name input
- Room Type dropdown
- Description textarea
- Max Capacity input
- Bed Type input
- Amenities checklist
- Status toggle: Available / Blocked
- Block Reason input (shown when Blocked selected)
- Photo management: current photos grid (reorderable, deletable), upload new photos drop zone
- "Save Changes" orange button

---

#### SCREEN A-05: Rate Management (`/rates`) — Admin Only

**Purpose:** Manage room rates, weekend rates, corporate rate, discounts.

**Layout:** Sidebar + content. Tab navigation: Room Rates | Weekend Rates | Corporate Rate | Discounts | Vouchers.

**Tab: Room Rates** — table: Room Type, Weekday Rate input, Weekend Rate input, Save button per row.

**Tab: Corporate Rate** — single global rate field or per-room-type overrides.

**Tab: Discounts** — Senior / PWD discount % input. Toggle enabled/disabled.

**Tab: Vouchers** — Voucher table (code, discount type, value, usage limit, expiry, status badge). "+ Add Voucher" button → inline form or modal.

**Modal M-06: Add/Edit Voucher** — Code, Discount Type (% or fixed), Value, Usage Limit, Expiry Date, Active toggle, Save button.

---

#### SCREEN A-06: Reports (`/reports`)

**Purpose:** Occupancy, revenue, and booking analytics with export.

**Layout:** Sidebar + content. Date range picker at top (applies to all report sections).

**Sections:**
- **Occupancy Rate** — large % display + bar chart by day/week
- **Revenue Summary** — total revenue, avg. per booking, avg. nightly rate
- **Bookings by Source** — pie chart or bar: Direct, Corporate, Walk-in, Rewards
- **Bookings Table** — filterable summary for selected period
- **"Export CSV"** button (top right)

---

#### SCREEN A-07: Corporate Inquiries (`/corporate`)

**Purpose:** Pipeline management for corporate account leads.

**Layout:** Sidebar + content. Kanban-style columns or table view with status filter.

**Columns (Kanban):** New Inquiry → Contacted → Proposal Sent → Access Code Issued → Closed

**Inquiry Card:** Company name, contact name, date, status badge.

**Drawer D-03: Inquiry Detail Drawer** — company info, contact info, notes log (append-only timeline), status dropdown, "Generate Access Code" orange button (generates a corporate access code stored in Firestore), access codes table for that company.

---

#### SCREEN A-08: Intercom Inbox (`/intercom`)

**Purpose:** Real-time chat management across all active guest rooms.

**Layout:** Sidebar + two-panel. Left: conversation list. Right: active chat.

**Left Panel (Conversation List):**
- Room number + last message preview
- Unread badge (orange pill)
- Quick Request badges (e.g., "Towels", "Housekeeping") shown under preview
- Notification sound toggle (top of panel)

**Right Panel (Chat View):**
- Room header (number, type, guest name if booked)
- Chat thread — staff messages right-aligned (orange), guest messages left-aligned
- Quick request badges in thread (highlighted differently from regular messages)
- Store orders shown as special cards in thread
- Message input + send button
- "Resolve" button to mark conversation as handled

---

#### SCREEN A-09: QR Management (`/qr`)

**Purpose:** Manage per-room QR codes that link to `/intercom/:roomId`.

**Layout:** Sidebar + content. Room grid with QR code per card.

**Elements:**
- Room grid — each card: Room number, embedded QR code (small preview), "Download" button, "Regenerate" button (with confirmation: regenerating invalidates old QR)
- "Print All" button (generates print-ready PDF of all QRs)

---

#### SCREEN A-10: Members — Spark Rewards (`/members`) — Admin Only

**Purpose:** View and manage Spark Rewards member accounts.

**Layout:** Sidebar + content. Search/filter bar + members table.

**Elements:**
- Search by name or email
- Members Table: Name, Email, Join Date, Total Points, Total Stays, Status (Active/Suspended)
- Row click → Member Detail Drawer

**Drawer D-04: Member Detail Drawer**
- Member avatar/initials, name, email, phone, join date
- Points balance (large, orange)
- Points History table: Date, Activity, Points ±
- "Adjust Points" inline form: ± amount, reason note, Submit button
- Total stays summary
- Suspend / Reactivate account button

---

#### SCREEN A-11: Settings (`/settings`) — Admin Only

**Purpose:** Hotel configuration, payment methods, staff accounts, website content.

**Layout:** Sidebar + content. Left sub-navigation tabs.

**Tabs:**
- **Hotel Info** — Hotel name, address, phone, email, check-in/check-out time, social links. Save button.
- **Payment Methods** — Toggles + detail fields for GCash (number, name), Maya (number, name), Bank Transfer (bank, account number, account name), Pay on Arrival. Save button.
- **Breakfast Settings** — Enable/disable breakfast option. Rate per person per night input.
- **Staff Accounts** — Staff table (name, email, role badge). "+ Add Staff" button → simple modal (email, role selector: Front Desk / Admin). Deactivate button per row.
- **Spark Rewards Config** — Points per stay, minimum redemption, redemption rate. Enable/disable toggle.
- **Store Config** — Enable/disable Spark Essentials store. Store name, operational hours.
- **Website Content** — Rich text or structured fields for editable homepage/about/corporate content blocks.

---

### ADMIN APP — Additional Drawers & Modals

---

#### DRAWER D-05: Store Order Detail (from Intercom or Store Reports)

Order ID, Room, Guest, Timestamp, Items ordered (product name, qty, price), Order total, Payment method, Status badge, "Mark as Delivered" orange button, "Cancel Order" danger button.

---

## 7. Component Library Reference

These reusable components appear across screens. Design once, reuse.

| Component | Description |
|---|---|
| `PrimaryButton` | Spark Orange `#EA8A1A`, white text, 8px radius, 44px height, hover darkens to `#C4720E` |
| `GhostButton` | Transparent, orange border + orange text, 8px radius |
| `DangerButton` | Red `#DC2626`, white text — destructive actions only |
| `StatusBadge` | Pill (9999px radius), text + background from status color table above |
| `RoomCard` | 12px radius, photo top, name, amenities, price — never price first |
| `StatsCard` | White card, 12px radius, label (small gray), value (large dark), optional trend indicator |
| `BookingSummaryCard` | Read-only recap: room photo thumbnail, room name, dates, guests, rate breakdown, total |
| `StepIndicator` | 4-step progress bar — active step orange, completed steps orange check, inactive gray |
| `DateRangePicker` | Blocks past dates, min 1-night enforced |
| `Drawer` | Right-side slide panel, full height, ~480px wide, white background, close X top-right |
| `Modal` | Centered overlay, white, 16px radius, backdrop blur, close X top-right |
| `DataTable` | Sortable, filterable, skeleton loading rows, row click action |
| `Navbar (Guest)` | Sticky, transparent → white on scroll, logo left, links center/right, Book Now CTA right |
| `Sidebar (Admin)` | `#111827`, 240px, white logo top, orange active indicator, version bottom |
| `ChatBubble` | Guest: right-aligned orange; Staff: left-aligned white with border |
| `QuickRequestChip` | Pill button in chat quick-select row |
| `PaymentMethodCard` | Radio card with icon + name, orange border when selected |

---

## 8. Screen Summary Index

### Guest App Screens

| ID | Screen | Route |
|---|---|---|
| G-01 | Homepage | `/` |
| G-02 | Rooms Page | `/rooms` |
| G-03 | Booking Step 1 — Select Room | `/book` |
| G-04 | Booking Step 2 — Guest Details | `/book` |
| G-05 | Booking Step 3 — Review & Pay | `/book` |
| G-06 | Booking Step 4 — Confirmation | `/book/confirm` |
| G-07 | My Booking Lookup | `/my-booking` |
| G-08 | Corporate Stays Marketing | `/corporate` |
| G-09 | Corporate Booking Gate + Flow | `/corporate/book` |
| G-10 | Spark Rewards Landing | `/rewards` |
| G-11 | Sign In | `/signin` |
| G-12 | Sign Up | `/signup` |
| G-13 | Member Profile | `/account/profile` |
| G-14 | My Stays | `/account/stays` |
| G-15 | My Rewards Portal | `/account/rewards` |
| G-16 | Intercom Guest Chat | `/intercom/:roomId` |
| G-17 | About Us | `/about` |
| G-18 | Contact Us | `/contact` |
| G-19 | 404 Not Found | `*` |

### Guest App Modals / Overlays

| ID | Component | Trigger |
|---|---|---|
| M-01 | Room Detail Modal | Rooms Page "View Details" |
| M-02 | Availability Filter Drawer (mobile) | Rooms Page filter bar |
| M-03 | Corporate Access Code Gate | `/corporate/book` landing |
| M-04 | Voucher Input (inline) | Booking Step 3 |

### Admin App Screens

| ID | Screen | Route |
|---|---|---|
| A-01 | Admin Login | `/login` |
| A-02 | Dashboard Overview | `/` |
| A-03 | Bookings Management | `/bookings` |
| A-04 | Room Management | `/rooms` |
| A-05 | Rate Management | `/rates` |
| A-06 | Reports | `/reports` |
| A-07 | Corporate Inquiries | `/corporate` |
| A-08 | Intercom Inbox | `/intercom` |
| A-09 | QR Management | `/qr` |
| A-10 | Members (Spark Rewards) | `/members` |
| A-11 | Settings | `/settings` |

### Admin App Drawers / Modals

| ID | Component | Trigger |
|---|---|---|
| D-01 | Booking Detail Drawer | Bookings table row click |
| D-02 | Room Edit Drawer | Room Management "Edit" |
| D-03 | Corporate Inquiry Detail Drawer | Corporate Inquiries card click |
| D-04 | Member Detail Drawer | Members table row click |
| D-05 | Store Order Detail Drawer | Intercom / Store Reports |
| M-05 | Walk-in Booking Modal | Bookings "+ Walk-in Booking" button |
| M-06 | Add/Edit Voucher Modal | Rate Management Vouchers tab |

---

## 9. Stitch Prompt Template

Use this template when prompting Stitch for each screen:

```
Design [SCREEN ID]: [Screen Name] for spark inn, a boutique hotel in Bohol, Philippines.

Brand:
- Primary color: #EA8A1A (Spark Orange) for all CTAs and active states
- Heading font: Apollo OTF (serif, elegant, sentence case)
- Body font: Inter
- Card radius: 12px | Button radius: 8px | Badge radius: 9999px
- Warm White section bg: #FDF8F3 | Dark bg: #111827
- No sharp corners. Minimum 44px touch height on all form fields.

Screen description:
[Paste the screen description from Section 6 above]

Style: Warm Minimal. Boutique hotel premium. Emotion-first, not feature-first. [OR: Efficiency-first dashboard, data density over decoration.]
```
