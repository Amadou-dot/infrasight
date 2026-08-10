/**
 * SEO Metadata Tests
 *
 * Pins the discoverability surface added in Phase 6: the routeMetadata()
 * helper's shape (lib/seo.ts), robots.txt crawl rules (app/robots.ts), and
 * the sitemap's route inventory (app/sitemap.ts). These are pure functions,
 * but what they encode is contract: a renamed route that skips the sitemap,
 * a dropped canonical, or a lost title template all regress silently in the
 * browser.
 */

import { routeMetadata, SITE_NAME, SITE_URL, TITLE_TEMPLATE } from '@/lib/seo';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

describe('routeMetadata', () => {
  it('should set title default plus the shared template for child segments', () => {
    const meta = routeMetadata({ title: 'Devices', description: 'd', path: '/devices' });

    // The template must be re-declared per layout: it does not cascade past a
    // layout that sets its own title, so omitting it here silently strips the
    // "· Infrasight" suffix from nested routes like /devices/[id].
    expect(meta.title).toEqual({ default: 'Devices', template: TITLE_TEMPLATE });
    expect(meta.description).toBe('d');
  });

  it('should point the canonical and og:url at the route path', () => {
    const meta = routeMetadata({ title: 'T', description: 'd', path: '/alerts/rules' });

    expect(meta.alternates).toEqual({ canonical: '/alerts/rules' });
    expect(meta.openGraph).toMatchObject({ url: '/alerts/rules' });
  });

  it('should restate openGraph siteName and type', () => {
    // Metadata fields are overwritten per top-level key, not deep-merged: a
    // route that sets openGraph at all replaces the root layout's object, so
    // the helper has to carry these or they vanish on every page but the root.
    const meta = routeMetadata({ title: 'T', description: 'd', path: '/p' });

    expect(meta.openGraph).toMatchObject({
      title: 'T',
      description: 'd',
      siteName: SITE_NAME,
      type: 'website',
    });
  });

  it('should emit noindex robots only when index is false', () => {
    const indexed = routeMetadata({ title: 'T', description: 'd', path: '/p' });
    const hidden = routeMetadata({ title: 'T', description: 'd', path: '/p', index: false });

    expect(indexed.robots).toBeUndefined();
    expect(hidden.robots).toEqual({ index: false });
  });
});

describe('robots', () => {
  it('should allow crawling but disallow the API', () => {
    expect(robots().rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    });
  });

  it('should reference the sitemap on the canonical host', () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe('sitemap', () => {
  it('should list every public content route on the canonical host', () => {
    const urls = sitemap().map(entry => entry.url);

    expect(urls).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/devices`,
      `${SITE_URL}/floor-plan`,
      `${SITE_URL}/analytics`,
      `${SITE_URL}/maintenance`,
      `${SITE_URL}/alerts`,
      `${SITE_URL}/alerts/rules`,
    ]);
  });

  it('should not claim lastModified', () => {
    // The handler is build-time cached under cacheComponents; a timestamp
    // would just be the deploy date masquerading as content freshness.
    for (const entry of sitemap()) expect(entry.lastModified).toBeUndefined();
  });
});
