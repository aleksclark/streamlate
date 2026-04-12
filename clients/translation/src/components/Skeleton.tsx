import { useThemeStore } from '../stores/themeStore';

export function Skeleton({ className = '' }: { className?: string }) {
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  return (
    <div
      className={`animate-pulse rounded ${isDark ? 'bg-gray-800' : 'bg-gray-200'} ${className}`}
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
