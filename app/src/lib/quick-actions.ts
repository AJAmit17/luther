import { setItems } from 'expo-quick-actions';
import type { RouterAction } from 'expo-quick-actions/router';

/** The long-press menu on the app icon; useQuickActionRouting opens each href. */
export function setQuickActions() {
  setItems<RouterAction>([
    { id: 'send', title: 'Send to Luther', subtitle: 'New task for an agent', icon: 'symbol:paperplane', params: { href: '/send' } },
    { id: 'home', title: 'Running now', icon: 'symbol:bolt.horizontal', params: { href: '/' } },
    { id: 'settings', title: 'Usage & settings', icon: 'symbol:gauge.with.dots.needle.33percent', params: { href: '/settings' } },
  ]);
}
