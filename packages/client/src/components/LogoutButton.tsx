// packages/client/src/components/LogoutButton.tsx
import { maskToken } from '@/config/auth';
import { Button } from '@/components/ui/button';

interface LogoutButtonProps {
  token?: string | null;
  onLogout: () => void;
}

export default function LogoutButton({ token, onLogout }: LogoutButtonProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-md bg-muted">
      {token ? (
        <div className="flex items-center gap-2 text-xs">
          {/* Paired devices hold a `pkd_` token; anything else is the shared PROKOPAI_AUTH_TOKEN. */}
          <span className="text-muted-foreground">{token.startsWith('pkd_') ? 'Paired device' : 'Shared token'}</span>
          <code className="font-mono text-foreground bg-background px-1.5 py-0.5 rounded text-[10px]">
            {maskToken(token)}
          </code>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">This computer</span>
        </div>
      )}
      <Button
        variant="destructive"
        size="sm"
        onClick={onLogout}
        title="Disconnect and clear token"
      >
        Logout
      </Button>
    </div>
  );
}
