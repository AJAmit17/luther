import type { ImageSourcePropType } from 'react-native';
import type { SFSymbol } from 'expo-symbols';

// The header toolbar on Android draws Material Symbols (image sources), not SF
// Symbols; each one a toolbar uses maps to its Material counterpart here.
const icons: Partial<Record<SFSymbol, ImageSourcePropType>> = {
  'arrow.uturn.backward': require('@expo/material-symbols/undo.xml'),
  plus: require('@expo/material-symbols/add.xml'),
  'square.and.pencil': require('@expo/material-symbols/edit_square.xml'),
  'square.grid.2x2': require('@expo/material-symbols/apps.xml'),
  terminal: require('@expo/material-symbols/terminal.xml'),
  desktopcomputer: require('@expo/material-symbols/computer.xml'),
  ellipsis: require('@expo/material-symbols/more_vert.xml'),
  'ellipsis.circle': require('@expo/material-symbols/more_vert.xml'),
  archivebox: require('@expo/material-symbols/archive.xml'),
  'arrow.triangle.branch': require('@expo/material-symbols/account_tree.xml'),
  'arrow.triangle.pull': require('@expo/material-symbols/merge.xml'),
  'arrow.up.circle': require('@expo/material-symbols/arrow_circle_up.xml'),
  'calendar.badge.plus': require('@expo/material-symbols/event.xml'),
  'chart.bar': require('@expo/material-symbols/bar_chart.xml'),
  'clock.arrow.circlepath': require('@expo/material-symbols/history.xml'),
  'doc.text.magnifyingglass': require('@expo/material-symbols/find_in_page.xml'),
  folder: require('@expo/material-symbols/folder.xml'),
  globe: require('@expo/material-symbols/language.xml'),
  'stop.circle': require('@expo/material-symbols/stop_circle.xml'),
  'text.book.closed': require('@expo/material-symbols/menu_book.xml'),
  trash: require('@expo/material-symbols/delete.xml'),
  'xmark.circle': require('@expo/material-symbols/cancel.xml'),
  keyboard: require('@expo/material-symbols/keyboard.xml'),
  'textformat.size.larger': require('@expo/material-symbols/text_increase.xml'),
  'textformat.size.smaller': require('@expo/material-symbols/text_decrease.xml'),
  'keyboard.chevron.compact.down': require('@expo/material-symbols/keyboard_hide.xml'),
};

/** A header toolbar icon: its Material Symbol on Android. */
export const tb = (sf: SFSymbol) => icons[sf];
