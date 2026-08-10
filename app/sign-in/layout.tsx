import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Sign in',
  description: 'Sign in to Infrasight.',
  path: '/sign-in',
  index: false,
});

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
