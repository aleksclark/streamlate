import { useThemeStore } from '../stores/themeStore';
import type { SessionHealthResponse } from '../api';

interface ChannelHealthProps {
  health: SessionHealthResponse | null;
}

function qualityColor(latency: number, loss: number): string {
  if (loss > 5 || latency > 200) return 'text-red-500';
  if (loss > 1 || latency > 100) return 'text-yellow-500';
  return 'text-green-500';
}

export function ChannelHealth({ health }: ChannelHealthProps) {
  const theme = useThemeStore((s) => s.theme);

  if (!health) {
    return (
      <div className={`text-xs ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>
        Waiting for health data...
      </div>
    );
  }

  const qColor = qualityColor(health.latency_ms, health.packet_loss);

  return (
    <div className={`rounded-lg p-4 ${
      theme === 'dark' ? 'bg-gray-900' : 'bg-white border border-gray-200'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${qColor.replace('text-', 'bg-')}`} />
        <h3 className={`text-sm font-semibold ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
        }`}>Channel Health</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <HealthMetric
          label="Latency"
          value={`${health.latency_ms}ms`}
          quality={health.latency_ms < 100 ? 'good' : health.latency_ms < 200 ? 'warning' : 'bad'}
          theme={theme}
        />
        <HealthMetric
          label="Packet Loss"
          value={`${health.packet_loss.toFixed(1)}%`}
          quality={health.packet_loss < 1 ? 'good' : health.packet_loss < 5 ? 'warning' : 'bad'}
          theme={theme}
        />
        <HealthMetric
          label="Jitter"
          value={`${health.jitter_ms}ms`}
          quality={health.jitter_ms < 10 ? 'good' : health.jitter_ms < 30 ? 'warning' : 'bad'}
          theme={theme}
        />
        <HealthMetric
          label="Bitrate"
          value={`${health.bitrate_kbps} kbps`}
          quality="good"
          theme={theme}
        />
      </div>
    </div>
  );
}

function HealthMetric({ label, value, quality, theme }: {
  label: string;
  value: string;
  quality: 'good' | 'warning' | 'bad';
  theme: string;
}) {
  const colorMap = {
    good: 'text-green-500',
    warning: 'text-yellow-500',
    bad: 'text-red-500',
  };

  return (
    <div>
      <div className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </div>
      <div className={`text-sm font-medium tabular-nums ${colorMap[quality]}`}>
        {value}
      </div>
    </div>
  );
}
