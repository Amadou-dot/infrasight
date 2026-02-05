'use client';

import { useClerk } from '@clerk/nextjs';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

export default function UnauthorizedPage() {
  const { signOut } = useClerk();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="pb-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 mb-4">
            <ShieldX className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground">
            Your account is not a member of an authorized organization.
            Please contact your administrator to get access.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: '/sign-in' })}
          >
            Sign out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
