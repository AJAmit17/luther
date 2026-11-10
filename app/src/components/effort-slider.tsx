import { useRef, useState } from 'react';
import { Host, Slider } from '@expo/ui/swift-ui';
import { tint } from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '@/design';

/** The effort stops as SwiftUI's own stepped slider; the level is sent when you let go. */
export function EffortSlider({ stops, value, onChange, onMove }: { stops: string[]; value: string; onChange: (e: string) => void; onMove: (i: number) => void }) {
  const { color, scheme } = useTheme();
  const [at, setAt] = useState<number | null>(null);
  const last = useRef<number | null>(null); // the drag's latest stop, for the release
  const i = at ?? Math.max(0, stops.indexOf(value));
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme={scheme}>
      <Slider
        value={i}
        min={0}
        max={Math.max(1, stops.length - 1)}
        step={1}
        modifiers={[tint(color.accent)]}
        onValueChange={(v) => {
          const n = Math.round(v);
          last.current = n;
          setAt(n);
          onMove(n);
        }}
        onEditingChanged={(editing) => {
          if (!editing && last.current !== null) {
            if (stops[last.current] !== value) onChange(stops[last.current]);
            last.current = null;
            setAt(null);
          }
        }}
      />
    </Host>
  );
}
