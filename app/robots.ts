import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/**
 * Only the API is disallowed here. Pages that should stay out of search
 * results (settings, auth pages, deleted devices) carry a meta noindex via
 * routeMetadata({ index: false }) instead — a robots.txt disallow would stop
 * crawlers from ever seeing that noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
