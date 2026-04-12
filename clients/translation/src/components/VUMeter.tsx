import { useThemeStore } from '../stores/themeStore';

interface VUMeterProps {
  level: number;
  label: string;
}

export function VUMeter({ level = -60, label }: VUMeterProps) {
  const theme = useThemeStore((s) => s.theme);
  const pct = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));

  const barColor = pct > 85
    ? 'bg-red-500'
    : pct > 65
      ? 'bg-yellow-500'
      : 'bg-green-500';

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-medium ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
        }`}>{label}</span>
        <span className={`text-xs tabular-nums ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>{level > -60 ? `${level.toFixed(0)} dB` : '-inf'}</span>
      </div>
      <div className={`w-full h-3 rounded-full overflow-hidden ${
        theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'
      }`}>
        <div
          className={`h-full rounded-full transition-all duration-75 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
