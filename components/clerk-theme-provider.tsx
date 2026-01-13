'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';

export function ClerkThemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <ClerkProvider
      appearance={{
        baseTheme: isDark ? dark : undefined,
        variables: {
          // Use explicit color values since CSS variables use oklch format
          // which is incompatible with Clerk's hsl() wrapper
          colorPrimary: isDark ? '#eaeaea' : '#333333',
          colorBackground: isDark ? '#252525' : '#ffffff',
          colorText: isDark ? '#fafafa' : '#171717',
          colorTextSecondary: isDark ? '#a3a3a3' : '#737373',
          colorInputBackground: isDark ? '#333333' : '#f5f5f5',
          colorInputText: isDark ? '#fafafa' : '#171717',
          colorDanger: isDark ? '#ef4444' : '#dc2626',
          colorSuccess: isDark ? '#22c55e' : '#16a34a',
          colorWarning: isDark ? '#f59e0b' : '#d97706',
          colorNeutral: isDark ? '#fafafa' : '#171717',
          colorTextOnPrimaryBackground: isDark ? '#171717' : '#fafafa',
        },
        elements: {
          // Card and modal styling
          card: isDark
            ? 'bg-[#252525] border border-white/10 shadow-xl text-white'
            : 'bg-white border border-gray-200 shadow-xl text-gray-900',
          modalBackdrop: 'bg-black/60 backdrop-blur-sm',
          modalContent: isDark
            ? 'bg-[#252525] border border-white/10'
            : 'bg-white border border-gray-200',

          // User profile modal
          userProfilePage: isDark ? 'bg-[#252525]' : 'bg-white',
          userProfileSection: isDark ? 'border-white/10' : 'border-gray-200',

          // Navigation tabs
          navbarButton: isDark
            ? 'text-gray-300 hover:text-white hover:bg-white/10'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
          navbarButtonActive: isDark ? 'text-white bg-white/10' : 'text-gray-900 bg-gray-100',

          // Form elements
          formFieldLabel: isDark ? 'text-gray-300' : 'text-gray-700',
          formFieldInput: isDark
            ? 'bg-[#333333] border-white/10 text-white placeholder:text-gray-500'
            : 'bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400',
          formButtonPrimary: isDark
            ? 'bg-white text-black hover:bg-gray-200'
            : 'bg-gray-900 text-white hover:bg-gray-800',

          // Header and footer
          headerTitle: isDark ? 'text-white' : 'text-gray-900',
          headerSubtitle: isDark ? 'text-gray-400' : 'text-gray-600',
          footerActionLink: isDark
            ? 'text-gray-300 hover:text-white'
            : 'text-gray-600 hover:text-gray-900',

          // User button popover
          userButtonPopoverCard: isDark
            ? 'bg-[#252525] border border-white/10'
            : 'bg-white border border-gray-200',
          userButtonPopoverActionButton: isDark
            ? 'hover:bg-white/10 text-gray-300'
            : 'hover:bg-gray-100 text-gray-700',
          userButtonPopoverActionButtonText: isDark ? 'text-gray-300' : 'text-gray-700',
          userButtonPopoverFooter: 'hidden',

          // Profile sections
          profileSectionTitle: isDark ? 'text-white' : 'text-gray-900',
          profileSectionContent: isDark ? 'text-gray-300' : 'text-gray-700',
          profileSectionPrimaryButton: isDark
            ? 'text-white hover:bg-white/10'
            : 'text-gray-900 hover:bg-gray-100',

          // Badges and tags
          badge: isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-700',

          // Dividers
          dividerLine: isDark ? 'bg-white/10' : 'bg-gray-200',
          dividerText: isDark ? 'text-gray-500' : 'text-gray-400',

          // Menu items
          menuButton: isDark
            ? 'text-gray-300 hover:text-white hover:bg-white/10'
            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100',
          menuList: isDark
            ? 'bg-[#252525] border border-white/10'
            : 'bg-white border border-gray-200',
          menuItem: isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100',

          // Alerts
          alertText: isDark ? 'text-gray-300' : 'text-gray-700',

          // Page specific
          pageScrollBox: isDark ? 'bg-[#252525]' : 'bg-white',

          // Account switcher
          userPreviewMainIdentifier: isDark ? 'text-white' : 'text-gray-900',
          userPreviewSecondaryIdentifier: isDark ? 'text-gray-400' : 'text-gray-600',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
