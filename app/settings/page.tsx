'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import { useTheme } from 'next-themes';
import {
  User,
  Mail,
  Shield,
  Moon,
  Sun,
  Monitor,
  LogOut,
  ExternalLink,
  Calendar,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  const { user, isLoaded } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const { theme, setTheme } = useTheme();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-muted rounded w-48" />
            <div className="h-64 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  const primaryEmail = user?.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId
  );

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return 'N/A';
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <header>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">
            Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your account settings and preferences
          </p>
        </header>

        {/* Profile Section */}
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Profile
          </h2>

          <div className="flex flex-col sm:flex-row gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={user.fullName || 'Profile'}
                  className="h-24 w-24 rounded-full border-2 border-border"
                />
              ) : (
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-10 w-10 text-primary" />
                </div>
              )}
            </div>

            {/* Profile Details */}
            <div className="flex-1 space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Full Name</label>
                <p className="text-foreground font-medium">
                  {user?.fullName || 'Not set'}
                </p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </label>
                <p className="text-foreground font-medium">
                  {primaryEmail?.emailAddress || 'No email'}
                  {primaryEmail?.verification?.status === 'verified' && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-500">
                      <Shield className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </p>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openUserProfile()}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Manage Profile in Clerk
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Sun className="h-5 w-5 text-primary" />
            Appearance
          </h2>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose how InfraSight looks to you. Select a theme preference.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => setTheme('light')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  theme === 'light'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <Sun className="h-6 w-6" />
                <span className="text-sm font-medium">Light</span>
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  theme === 'dark'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <Moon className="h-6 w-6" />
                <span className="text-sm font-medium">Dark</span>
              </button>

              <button
                onClick={() => setTheme('system')}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                  theme === 'system'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <Monitor className="h-6 w-6" />
                <span className="text-sm font-medium">System</span>
              </button>
            </div>
          </div>
        </section>

        {/* Account Info Section */}
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Account Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Account Created
              </label>
              <p className="text-foreground font-medium">
                {formatDate(user?.createdAt ? new Date(user.createdAt) : null)}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last Sign In
              </label>
              <p className="text-foreground font-medium">
                {formatDate(user?.lastSignInAt ? new Date(user.lastSignInAt) : null)}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">User ID</label>
              <p className="text-foreground font-mono text-sm bg-muted px-2 py-1 rounded inline-block">
                {user?.id}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Two-Factor Auth</label>
              <p className="text-foreground font-medium">
                {user?.twoFactorEnabled ? (
                  <span className="text-green-500 flex items-center gap-1">
                    <Shield className="h-4 w-4" />
                    Enabled
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not enabled</span>
                )}
              </p>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-card border border-red-500/20 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-red-500 mb-4 flex items-center gap-2">
            <LogOut className="h-5 w-5" />
            Session
          </h2>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-foreground font-medium">Sign out of InfraSight</p>
              <p className="text-sm text-muted-foreground">
                You will be redirected to the sign-in page
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => signOut({ redirectUrl: '/sign-in' })}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
