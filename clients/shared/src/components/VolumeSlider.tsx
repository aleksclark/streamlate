export function VolumeSlider({
  value = 100,
  onChange,
  label,
}: {
  value?: number;
  onChange?: (value: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 w-full">
      {label && <span className="text-sm text-gray-400 min-w-[60px]">{label}</span>}
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="flex-1 h-2 accent-emerald-500 cursor-pointer"
        aria-label={label}
      />
      <span className="text-xs text-gray-500 min-w-[32px] text-right">{value}%</span>
    </div>
  );
}
