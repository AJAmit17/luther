import AgentsWidget, { type AgentsWidgetProps } from '../widgets/AgentsWidget';
import SendWidget from '../widgets/SendWidget';

let last = '';

/** The home-screen widgets' data, from Home's reads; written only when it
 *  changes, since each write reloads the widget's timeline. */
export function updateWidgets(props: AgentsWidgetProps) {
  const next = JSON.stringify(props);
  if (next === last) return;
  last = next;
  try {
    AgentsWidget.updateSnapshot(props);
    SendWidget.updateSnapshot({});
  } catch {
    // widgets unavailable (no extension in this build)
  }
}
