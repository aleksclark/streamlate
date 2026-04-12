import type { ConnectionState } from '../stores/sessionStore';

interface ConnectionStatusProps {
  state: ConnectionState;
}

const statusConfig: Record<ConnectionState, { label: string; dotColor: string; textColor: string }> = {
  disconnected: { label: 'Disconnected', dotColor: 'bg-gray-500', textColor: 'text-gray-500' },
  connecting: { label: 'Connecting...', dotColor: 'bg-yellow-500 animate-pulse', textColor: 'text-yellow-500' },
  connected: { label: 'Connected', dotColor: 'bg-green-500', textColor: 'text-green-500' },
  reconnecting: { label: 'Reconnecting...', dotColor: 'bg-orange-500 animate-pulse', textColor: 'text-orange-500' },
  failed: { label: 'Connection Failed', dotColor: 'bg-red-500', textColor: 'text-red-500' },
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  const config = statusConfig[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      <span className={`text-xs font-medium ${config.textColor}`}>{config.label}</span>
    </div>
  );
}
