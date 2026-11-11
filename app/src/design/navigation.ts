import type { Palette } from './theme';
/** A header search bar in the active scheme (Android's default is white on white in light). */
export const searchBarColors = (color: Palette) => ({ textColor: color.text, hintTextColor: color.faint, headerIconColor: color.text, tintColor: color.accent, barTintColor: color.card });
