import { useToastStore, type ToastType } from '../stores/toastStore';
import { useThemeStore } from '../stores/themeStore';

const typeStyles: Record<ToastType, { dark: string; light: string; icon: string }> = {
  success: {
    dark: 'bg-green-900/80 border-green-700 text-green-200',
    light: 'bg-green-50 border-green-300 text-green-800',
    icon: '✓',
  },
  error: {
    dark: 'bg-red-900/80 border-red-700 text-red-200',
    light: 'bg-red-50 border-red-300 text-red-800',
    icon: '✕',
  },
  warning: {
    dark: 'bg-amber-900/80 border-amber-700 text-amber-200',
    light: 'bg-amber-50 border-amber-300 text-amber-800',
    icon: '⚠',
  },
  info: {
    dark: 'bg-blue-900/80 border-blue-700 text-blue-200',
    light: 'bg-blue-50 border-blue-300 text-blue-800',
    icon: 'ℹ',
  },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" data-testid="toast-container">
      {toasts.map((toast) => {
        const style = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm shadow-lg animate-slide-in ${
              isDark ? style.dark : style.light
            }`}
            data-testid="toast"
            onClick={() => removeToast(toast.id)}
          >
            <span className="font-bold text-base">{style.icon}</span>
            <span className="flex-1">{toast.message}</span>
            <button className="ml-2 opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
          </div>
        );
      })}
    </div>
  );
}
