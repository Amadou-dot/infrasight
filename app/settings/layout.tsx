import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Settings',
  description: 'Profile, theme, and session settings.',
  path: '/settings',
  index: false,
});

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
