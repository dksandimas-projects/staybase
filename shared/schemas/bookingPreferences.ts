// Per SR-01..05 (2026-10-12): the Zod schemas for the admin-
// configurable bed set-ups + booking preferences catalogs that
// live on `HotelConfig`. Shared between the admin app's
// Booking Preferences tab (settings writes) and the guest
// app's Step 2 selectors (settings reads, validation of the
// guest's submitted `value` against the catalog).
//
// Single source of truth — the same `.strict()` shape is
// re-validated on every write (admin save → settings doc) and
// read (Step 2 + server create). The Firestore schema stays
// open (`bedSetups: unknown[]`) for back-compat with any
// legacy doc that hasn't been migrated; the Zod schemas
// here are the gate.
import { z } from "zod";

// Catalog row schemas — used by both admin (write) and the
// guest Step 2 (validation against the read catalog).
// `value` is the kebab-case slug stored on `roomTypes[i].bedSetupValues`
// + `Booking.bedSetup`; `label` is the display string. `icon`
// is optional — same `KNOWN_CONTENT_ICONS` slug the rest of
// the public site uses, rendered by both apps.
export const bedSetupOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, {
      message:
        "Bed setup keys must be kebab-case (lowercase letters, digits, '-' or '_')."
    }),
  label: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(40).optional()
}).strict();

export const bookingPreferenceOptionSchema = z.object({
  value: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, {
      message:
        "Preference keys must be kebab-case (lowercase letters, digits, '-' or '_')."
    }),
  label: z.string().trim().min(1).max(160),
  icon: z.string().trim().max(40).optional(),
  // `surchargeNote` is the small "(additional charges may
  // apply)" caveat rendered next to the label. Informational
  // only — no per-preference surcharge is wired (see the
  // SPEC plan). Optional + bounded so a typo can't ship.
  surchargeNote: z.string().trim().max(120).optional()
}).strict();

// Whole-catalog schemas — the admin saves/replaces the
// catalog as one atomic write.
export const bedSetupsCatalogSchema = z.array(bedSetupOptionSchema).max(40);
export const bookingPreferencesCatalogSchema = z
  .array(bookingPreferenceOptionSchema)
  .max(60);