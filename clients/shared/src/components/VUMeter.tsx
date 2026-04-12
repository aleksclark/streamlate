export function VUMeter({
  level = -60,
  label,
}: {
  level?: number;
  label?: string;
}) {
  const clamped = Math.max(-60, Math.min(0, level));
  const pct = ((clamped + 60) / 60) * 100;

  const color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';

  return (
    <div
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-label={label}
      data-level={Math.round(clamped)}
      className="w-full"
    >
      <div className="h-3 rounded bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded transition-all duration-75"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
