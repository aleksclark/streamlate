export function VUMeter({ level = -60 }: { level?: number }) {
  const pct = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));
  return (
    <div style={{ width: '100%', height: 8, background: '#333', borderRadius: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', borderRadius: 4 }} />
    </div>
  );
}
