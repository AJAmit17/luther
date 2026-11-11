import { Switch } from 'react-native';
import { useTheme } from './theme';

export type ToggleProps = { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; label: string };

export function Toggle({ value, onValueChange, disabled, label }: ToggleProps) {
  const { color } = useTheme();
  return <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: color.accent }} accessibilityLabel={label} />;
}
