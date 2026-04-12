interface VUMeterProps {
  level: number;
  rmsDb: number;
  className?: string;
}

export function VUMeter({ level, rmsDb, className = '' }: VUMeterProps) {
  const segments = 30;
  const activeSegments = Math.round(level * segments);

  return (
    <div className={`w-full ${className}`} data-testid="vu-meter" data-level={level} data-rms-db={rmsDb}>
      <div className="flex gap-0.5 h-8 items-end">
        {Array.from({ length: segments }, (_, i) => {
          const active = i < activeSegments;
          let color = 'bg-green-500';
          if (i >= segments * 0.75) color = 'bg-red-500';
          else if (i >= segments * 0.5) color = 'bg-yellow-500';

          return (
            <div
              key={i}
              className={`flex-1 h-full rounded-sm transition-opacity duration-75 ${
                active ? color : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
          );
        })}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center" data-testid="vu-meter-db">
        {rmsDb > -100 ? `${rmsDb.toFixed(1)} dB` : '— dB'}
      </div>
    </div>
  );
}
