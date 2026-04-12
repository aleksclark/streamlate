export function VolumeSlider({
  value = 100,
  onChange,
}: {
  value?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange?.(Number(e.target.value))}
    />
  );
}
