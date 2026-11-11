import { StepSlider } from '@/design';

/** The effort stops on the shared stepped slider (drawn like iOS's); the level is sent when you let go. */
export function EffortSlider({ stops, value, onChange, onMove }: { stops: string[]; value: string; onChange: (e: string) => void; onMove: (i: number) => void }) {
  return (
    <StepSlider
      count={stops.length}
      value={Math.max(0, stops.indexOf(value))}
      label="Effort"
      text={(i) => stops[i] ?? ''}
      onMove={onMove}
      onChange={(i) => stops[i] !== value && onChange(stops[i])}
    />
  );
}
