import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";

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
  image = brandAsset(config.logos.standard),
  noIndex = false,
  type = "website"
}: PageMetaProps) {
  const location = useLocation();
  const fullTitle = title === config.pageTitle ? config.pageTitle : `${config.pageTitle} | ${title}`;
  const canonicalUrl = `https://${config.domain}${location.pathname}`;
  const absoluteImage = image.startsWith("http") ? image : `https://${config.domain}${image}`;

  useEffect(() => {
    document.title = fullTitle;
    setMeta("name", "description", description);
    setLink("canonical", canonicalUrl);

    if (noIndex) {
      setMeta("name", "robots", "noindex, nofollow");
    } else {
      removeMeta("name", "robots");
    }

    setMeta("property", "og:type", type);
    setMeta("property", "og:site_name", config.brandName);
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:image", absoluteImage);

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", absoluteImage);
  }, [absoluteImage, canonicalUrl, description, fullTitle, noIndex, type]);

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
