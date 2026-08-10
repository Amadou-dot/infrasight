import { routeMetadata } from '@/lib/seo';

export const metadata = routeMetadata({
  title: 'Sign up',
  description: 'Create an Infrasight account.',
  path: '/sign-up',
  index: false,
});

export default function SignUpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
