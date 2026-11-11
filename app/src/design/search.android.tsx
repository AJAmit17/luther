import { SearchField } from './field';
import type { SearchOptions } from './search';

export type { SearchOptions };

/** A screen's search. Android: the app's own field in the content, not Material's header search. */
export function useHeaderSearch(options: SearchOptions) {
  return { headerSearchBarOptions: undefined, field: <SearchField {...options} /> };
}
