import { useThemeStore } from '../stores/themeStore';

interface VolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
}

export function VolumeSlider({ value, onChange, label }: VolumeSliderProps) {
  const theme = useThemeStore((s) => s.theme);

  return (
    <div className="flex items-center gap-3 w-full">
      <label className={`text-xs font-medium min-w-[4rem] ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
      }`}>{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-blue-500"
        style={{
          background: `linear-gradient(to right, rgb(59 130 246) ${value}%, ${theme === 'dark' ? 'rgb(31 41 55)' : 'rgb(229 231 235)'} ${value}%)`,
        }}
      />
      <span className={`text-xs tabular-nums min-w-[2rem] text-right ${
        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
      }`}>{value}%</span>
    </div>
  );
}
