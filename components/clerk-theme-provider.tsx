'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';

export function ClerkThemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      appearance={{
        baseTheme: resolvedTheme === 'dark' ? dark : undefined,
        variables: {
          colorPrimary: 'hsl(var(--primary))',
          colorBackground: 'hsl(var(--background))',
          colorText: 'hsl(var(--foreground))',
          colorInputBackground: 'hsl(var(--input))',
          colorInputText: 'hsl(var(--foreground))',
        },
        elements: {
          card: 'bg-card border border-border shadow-lg',
          userButtonPopoverCard: 'bg-card border border-border',
          userButtonPopoverActionButton: 'hover:bg-accent',
          userButtonPopoverActionButtonText: 'text-foreground',
          userButtonPopoverFooter: 'hidden',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
