import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { currentHost, post, resolve } from '@/lib/hosts';

/** Open a link the Mac hands out (a preview, an artifact) in a Safari sheet,
 *  through the route this phone reaches the Mac on. */
export async function openOnMac(path: string) {
  const h = await currentHost();
  if (!h) throw new Error('No Mac paired');
  await WebBrowser.openBrowserAsync((await resolve(h)) + path, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
}

/** An agent's HTML page (show_artifact): a fresh link each time, so a page
 *  the agent has since edited opens as it is now. */
export async function openArtifact(id: string, title: string) {
  try {
    const { path } = await post<{ path: string }>(`/artifacts/${encodeURIComponent(id)}/link`, {});
    await openOnMac(path);
  } catch (e: any) {
    Alert.alert(`Couldn't open “${title}”`, e.message);
  }
}
