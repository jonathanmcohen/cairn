import { getAuthContext } from '@/lib/auth/require-role';

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Welcome to Cairn</h1>
      <p className="mt-2 text-muted-foreground">
        You're signed in as <strong>{ctx?.role}</strong>.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Pages, the editor, search, databases, and uploads land in subsequent plans.
      </p>
    </div>
  );
}
