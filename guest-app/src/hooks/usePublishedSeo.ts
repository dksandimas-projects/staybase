import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { SeoPublishSchema, type SeoPublishValues } from "@spark-inn/shared";
import { db } from "../firebase/config";

let cachedPublishedSeo: SeoPublishValues | null = null;
let publishedSeoRequest: Promise<SeoPublishValues | null> | null = null;
let hasLoadedPublishedSeo = false;

function loadPublishedSeo() {
  if (hasLoadedPublishedSeo) return Promise.resolve(cachedPublishedSeo);
  if (publishedSeoRequest) return publishedSeoRequest;

  publishedSeoRequest = getDoc(doc(db, "settings", "seo"))
    .then((snapshot) => {
      const parsed = SeoPublishSchema.safeParse(snapshot.data()?.published);
      cachedPublishedSeo = parsed.success ? parsed.data : null;
      hasLoadedPublishedSeo = true;
      return cachedPublishedSeo;
    })
    .catch(() => {
      hasLoadedPublishedSeo = true;
      return null;
    })
    .finally(() => {
      publishedSeoRequest = null;
    });
  return publishedSeoRequest;
}

export function usePublishedSeo() {
  const [publishedSeo, setPublishedSeo] = useState<SeoPublishValues | null>(cachedPublishedSeo);

  useEffect(() => {
    let active = true;
    void loadPublishedSeo().then((value) => {
      if (active) setPublishedSeo(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return publishedSeo;
}
