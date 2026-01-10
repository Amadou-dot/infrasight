import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        <SignIn />

        {/* Guest credentials for portfolio visitors */}
        <div className="rounded-lg border border-border bg-muted/50 p-4 text-center text-sm max-w-sm">
          <p className="font-medium text-foreground mb-2">Just browsing?</p>
          <p className="text-muted-foreground">
            Email: <code className="bg-background px-1.5 py-0.5 rounded text-foreground">guest@infrasight.com</code>
          </p>
          <p className="text-muted-foreground mt-1">
            Password: <code className="bg-background px-1.5 py-0.5 rounded text-foreground">infrasightguest</code>
          </p>
        </div>
      </div>
    </div>
  );
}
