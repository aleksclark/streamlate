import type { ConnectionState } from '../hooks/useListenerWebRTC';

interface ConnectionStatusProps {
  state: ConnectionState;
  className?: string;
}

const statusConfig: Record<ConnectionState, { color: string; label: string; pulse: boolean }> = {
  idle: { color: 'bg-gray-500', label: 'Idle', pulse: false },
  connecting: { color: 'bg-yellow-500', label: 'Connecting…', pulse: true },
  connected: { color: 'bg-green-500', label: 'Connected', pulse: false },
  reconnecting: { color: 'bg-yellow-500', label: 'Reconnecting…', pulse: true },
  disconnected: { color: 'bg-red-500', label: 'Disconnected', pulse: false },
};

export function ConnectionStatus({ state, className = '' }: ConnectionStatusProps) {
  const { color, label, pulse } = statusConfig[state];

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="connection-status" data-state={state}>
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />
      <span className="text-sm text-gray-600 dark:text-gray-300" data-testid="connection-status-text">{label}</span>
    </div>
  );
}
