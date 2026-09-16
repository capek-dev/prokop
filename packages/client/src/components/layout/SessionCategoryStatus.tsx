import type { SessionCategories } from '@/hooks/useSessionCategories';
import { Button } from '@/components/ui/button';

export function SessionCategoryStatus({ category }: { category?: SessionCategories['archived'] }) {
  if (!category) return null;
  return (
    <div className="flex flex-col gap-1 px-2">
      {category.isLoading && <p role="status" className="text-xs text-muted-foreground">Loading sessions...</p>}
      {category.error && (
        <div role="alert" className="text-xs text-destructive">
          Failed to load sessions.
          <Button variant="ghost" size="sm" onClick={category.retry}>Retry</Button>
        </div>
      )}
      {category.hasNextPage && (
        <Button variant="ghost" size="sm" onClick={category.fetchNextPage} disabled={category.isFetchingNextPage}>
          {category.isFetchingNextPage ? 'Loading more...' : 'Load more sessions'}
        </Button>
      )}
    </div>
  );
}
