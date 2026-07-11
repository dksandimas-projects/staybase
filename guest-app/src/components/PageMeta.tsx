import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import config from "@config";
import { usePublishedSeo } from "../hooks/usePublishedSeo";

interface PageMetaProps {
  title: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
  type?: "website" | "article";
}

export function PageMeta({
  title,
  description = config.metaDescription,
  image,
  noIndex = false,
  type = "website"
}: PageMetaProps) {
  const location = useLocation();
  const publishedSeo = usePublishedSeo();
  const fullTitle = title === config.pageTitle ? config.pageTitle : `${config.pageTitle} | ${title}`;
  const canonicalUrl = `https://${config.domain}${location.pathname}`;
  const effectiveDescription = title === config.pageTitle
    ? publishedSeo?.metaDescription || description
    : description;
  const effectiveImage = image || publishedSeo?.ogImage || config.ogImage;
  const absoluteImage = effectiveImage.startsWith("http")
    ? effectiveImage
    : `https://${config.domain}/${effectiveImage.replace(/^\/+/, "")}`;
  const twitterHandle = publishedSeo?.twitterHandle || config.twitterHandle;

  useEffect(() => {
    document.title = fullTitle;
    setMeta("name", "description", effectiveDescription);
    setLink("canonical", canonicalUrl);

    if (noIndex) {
      setMeta("name", "robots", "noindex, nofollow");
    } else {
      removeMeta("name", "robots");
    }

    setMeta("property", "og:type", type);
    setMeta("property", "og:site_name", config.brandName);
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", effectiveDescription);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:image", absoluteImage);
    setMeta("property", "og:image:width", "1200");
    setMeta("property", "og:image:height", "630");
    setMeta("property", "og:image:alt", config.brandName);
    setMeta("property", "og:locale", config.locale);

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", effectiveDescription);
    setMeta("name", "twitter:image", absoluteImage);
    if (twitterHandle.trim()) {
      const handle = twitterHandle.startsWith("@") ? twitterHandle : `@${twitterHandle}`;
      setMeta("name", "twitter:site", handle);
    } else {
      removeMeta("name", "twitter:site");
    }
  }, [absoluteImage, canonicalUrl, effectiveDescription, fullTitle, noIndex, twitterHandle, type]);

  return null;
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  const selector = `meta[${attribute}="${key}"]`;
  const element = document.head.querySelector(selector) ?? document.createElement("meta");
  element.setAttribute(attribute, key);
  element.setAttribute("content", content);
  if (!element.parentElement) document.head.appendChild(element);
}

function removeMeta(attribute: "name" | "property", key: string) {
  document.head.querySelector(`meta[${attribute}="${key}"]`)?.remove();
}

function setLink(rel: string, href: string) {
  const selector = `link[rel="${rel}"]`;
  const element = document.head.querySelector(selector) ?? document.createElement("link");
  element.setAttribute("rel", rel);
  element.setAttribute("href", href);
  if (!element.parentElement) document.head.appendChild(element);
}
