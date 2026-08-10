import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Unauthorized',
  description: 'This account is not a member of an allowed organization.',
  path: '/unauthorized',
  index: false,
});

export default function UnauthorizedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
