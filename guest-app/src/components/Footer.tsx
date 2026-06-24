import { VERSION } from "@spark-inn/shared";
import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";

const footerLinks = [
  { label: "About", to: "/about" },
  { label: "Rooms", to: "/rooms" },
  { label: "Corporate", to: "/corporate" },
  { label: "Rewards", to: "/rewards" },
  { label: "My Booking", to: "/my-booking" },
  { label: "Contact", to: "/contact" },
  { label: "Privacy", to: "/privacy" },
  { label: "Terms", to: "/terms" }
];

export function Footer() {
  const address = `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const phoneHref = `tel:${config.frontDeskPhone.replace(/[^\d+]/g, "")}`;

  return (
    <footer className="bg-sidebar text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <img src={brandAsset(config.logos.white)} alt={config.brandName} className="h-16 w-auto object-contain" />
          <p className="mt-5 max-w-md text-sm leading-6 text-gray-300">{config.brandPromise}</p>
          <p className="mt-5 text-xs text-gray-400">{config.brandName} v{VERSION}</p>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Explore</h2>
          <div className="mt-4 grid gap-3 text-sm text-gray-300">
            {footerLinks.map((item) => (
              <Link key={item.to} to={item.to} className="transition hover:text-primary-light">
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-primary">Contact</h2>
          <div className="mt-4 grid gap-3 text-sm text-gray-300">
            <a className="flex gap-3 transition hover:text-primary-light" href={mapsUrl} target="_blank" rel="noreferrer">
              <MapPin className="mt-0.5 shrink-0 text-primary" size={16} />
              {address}
            </a>
            <a className="flex gap-3 transition hover:text-primary-light" href={phoneHref}>
              <Phone className="mt-0.5 shrink-0 text-primary" size={16} />
              {config.frontDeskPhone}
            </a>
            <a className="flex gap-3 transition hover:text-primary-light" href={`mailto:${config.supportEmail}`}>
              <Mail className="mt-0.5 shrink-0 text-primary" size={16} />
              {config.supportEmail}
            </a>
          </div>
          <div className="mt-5 flex gap-3 text-gray-300">
            <a
              aria-label={`${config.brandName} on Facebook`}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/10 transition hover:border-primary hover:text-primary-light"
              href={config.facebookUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Facebook size={18} />
            </a>
            <a
              aria-label={`${config.brandName} on Instagram`}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/10 transition hover:border-primary hover:text-primary-light"
              href={config.instagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Instagram size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
