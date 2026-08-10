import type { Metadata } from 'next';

/**
 * Canonical production origin. The apex domain 307-redirects to www, so every
 * canonical URL, og:url, and sitemap entry must use the www host — a canonical
 * pointing at the apex would tell crawlers the "real" page lives behind a
 * redirect.
 */
export const SITE_URL = 'https://www.infrasight.org';

export const SITE_NAME = 'Infrasight';

export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

interface RouteMetadataInput {
  /** Route title, templated into `%s · Infrasight` by the root layout. */
  title: string;
  description: string;
  /** Route path starting with `/`, resolved against metadataBase. */
  path: string;
  /** Set false for pages crawlers should not index (settings, auth pages). */
  index?: boolean;
}

/**
 * Per-route metadata with a per-route canonical and og:url.
 *
 * Two Metadata API behaviours make this helper necessary rather than setting
 * everything once in the root layout:
 *
 * - `alternates.canonical` does not resolve relative to the current route —
 *   a single value in the root layout would stamp every page with the same
 *   canonical URL, so each route must declare its own path.
 * - Metadata fields are overwritten per top-level key, not deep-merged: a
 *   route that sets `openGraph` at all replaces the root layout's entire
 *   openGraph object, so `siteName` and `type` have to be restated here or
 *   they vanish from every page but the dashboard.
 *
 * og:image is not set here on purpose — the file conventions
 * (`app/opengraph-image.png`, `app/twitter-image.png`) inject it on every
 * route regardless of what the metadata objects contain.
 */
export function routeMetadata({ title, description, path, index = true }: RouteMetadataInput): Metadata {
  return {
    // `title.template` does not cascade past a layout that declares its own
    // title: /devices setting a plain string would strip the suffix from
    // /devices/[id]. Re-declaring the template here keeps it flowing to child
    // segments; the parent's template still applies to `default` itself.
    title: { default: title, template: TITLE_TEMPLATE },
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: 'website',
    },
    ...(index ? {} : { robots: { index: false } }),
  };
}
