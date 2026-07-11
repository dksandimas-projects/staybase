import { z } from "zod";

const optionalUrl = z.string().trim().max(500).refine(
  (value) => value === "" || /^https:\/\//i.test(value),
  "Enter a secure URL beginning with https://"
);

export const SeoPublishSchema = z.object({
  metaDescription: z.string().trim().min(50).max(160),
  priceRange: z.string().trim().min(1).max(20),
  ogImage: optionalUrl,
  twitterHandle: z.string().trim().max(50).regex(/^@?[A-Za-z0-9_]*$/, "Enter a valid X handle"),
  address: z.string().trim().min(5).max(300),
  frontDeskPhone: z.string().trim().min(5).max(50),
  facebookUrl: optionalUrl,
  instagramUrl: optionalUrl,
  checkInTime: z.string().trim().min(1).max(30),
  checkOutTime: z.string().trim().min(1).max(30)
});

export type SeoPublishValues = z.infer<typeof SeoPublishSchema>;

export interface SeoSettings {
  draft?: Partial<Pick<SeoPublishValues, "metaDescription" | "priceRange" | "ogImage" | "twitterHandle">>;
  published?: SeoPublishValues;
  publishedAt?: unknown;
  publishedBy?: string;
}
