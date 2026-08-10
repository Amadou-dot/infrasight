import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/**
 * The public content routes only. Detail pages (/devices/[id], /alerts/[id])
 * are deep links for humans, not landing pages — 500 near-identical thin pages
 * in the sitemap would dilute crawl budget, and crawlers that want them can
 * follow the links from /devices.
 *
 * No lastModified: this handler is cached at build time (cacheComponents), so
 * a timestamp would just be the deploy date presented as content freshness.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/devices`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/floor-plan`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/analytics`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/maintenance`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/alerts`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/alerts/rules`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
