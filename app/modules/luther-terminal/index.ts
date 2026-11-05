import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

export type TerminalHandle = {
  feed: (b64: string) => Promise<void>;
  focus: () => Promise<void>;
  blur: () => Promise<void>;
  reset: () => Promise<void>;
  size: () => Promise<{ cols: number; rows: number }>;
};

export type TerminalViewProps = ViewProps & {
  ref?: Ref<TerminalHandle>;
  fontSize?: number;
  dark?: boolean;
  /** Bytes typed on the phone, base64. */
  onInput?: (e: { nativeEvent: { data: string } }) => void;
  /** The grid the view fits at its size and font. */
  onResize?: (e: { nativeEvent: { cols: number; rows: number } }) => void;
};

/** A native terminal (SwiftTerm): feed it the pty's bytes; it renders them and owns the keyboard. */
export const TerminalView = requireNativeView<TerminalViewProps>('LutherTerminal');
