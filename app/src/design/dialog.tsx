import { Alert, type AlertButton } from 'react-native';

export function alert(title: string, message?: string, buttons?: AlertButton[]) {
  Alert.alert(title, message, buttons);
}

export function prompt(title: string, message: string | undefined, done: (text: string) => void, kind: 'plain-text' | 'secure-text' = 'plain-text', value = '') {
  Alert.prompt(title, message, done, kind, value);
}

/** Nothing on iOS: the system draws its own. */
export const DialogHost = () => null;
