import { useRef, useState } from 'react';
import { Host } from '@expo/ui';
import { Slider } from '@expo/ui/jetpack-compose';
import { c, tint, useHex } from '@/components/ui';

/** The effort stops as Material's stepped slider; the level is sent when you let go. */
export function EffortSlider({ stops, value, onChange, onMove }: { stops: string[]; value: string; onChange: (e: string) => void; onMove: (i: number) => void }) {
  const h = useHex();
  const [at, setAt] = useState<number | null>(null);
  const last = useRef<number | null>(null); // the drag's latest stop, for the release
  const i = at ?? Math.max(0, stops.indexOf(value));
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme={h.dark ? 'dark' : 'light'} seedColor={c.accent}>
      <Slider
        value={i}
        min={0}
        max={Math.max(1, stops.length - 1)}
        steps={Math.max(0, stops.length - 2)}
        colors={{ thumbColor: c.accent, activeTrackColor: c.accent, inactiveTrackColor: tint('text', 0.12), activeTickColor: c.onAccent, inactiveTickColor: tint('text', 0.4) }}
        onValueChange={(v) => {
          const n = Math.round(v);
          last.current = n;
          setAt(n);
          onMove(n);
        }}
        onValueChangeFinished={() => {
          if (last.current !== null && stops[last.current] !== value) onChange(stops[last.current]);
          last.current = null;
          setAt(null);
        }}
      />
    </Host>
  );
}
