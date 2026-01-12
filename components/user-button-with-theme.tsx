'use client';

import { UserButton } from '@clerk/nextjs';
import { Moon, Sun, Settings } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';

export function UserButtonWithTheme() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  return (
    <UserButton afterSignOutUrl="/sign-in">
      <UserButton.MenuItems>
        <UserButton.Action
          label="Settings"
          labelIcon={<Settings className="h-4 w-4" />}
          onClick={() => router.push('/settings')}
        />
        <UserButton.Action
          label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          labelIcon={theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
