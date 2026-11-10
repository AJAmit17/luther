import { useEffect, useMemo, useRef } from 'react';
import { searchBarColors } from './navigation';
import { useTheme } from './theme';

export type SearchOptions = { placeholder: string; onChange: (query: string) => void; live?: boolean };

/** iOS: the native header search bar (`field` is null); Android: search.android.tsx.
 *  `live` reports every keystroke, else the query lands on submit and '' on clear. */
export function useHeaderSearch({ placeholder, onChange, live }: SearchOptions) {
  const { color } = useTheme();
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const headerSearchBarOptions = useMemo(
    () => ({
      ...searchBarColors(color),
      placeholder,
      onChangeText: (e: { nativeEvent: { text: string } }) => (live || !e.nativeEvent.text) && latest.current(live ? e.nativeEvent.text : ''),
      onSearchButtonPress: (e: { nativeEvent: { text: string } }) => latest.current(e.nativeEvent.text.trim()),
      onCancelButtonPress: () => latest.current(''),
    }),
    [color, placeholder, live],
  );
  return { headerSearchBarOptions, field: null };
}
