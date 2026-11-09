import * as Speech from 'expo-speech';
import { toSpeech } from '@/lib/speech-text';

// Read-aloud on the phone itself (the system voice): one message at a time.
let reading: string | null = null;

export const isReading = (id: string) => reading === id;

export function readAloud(id: string, markdown: string) {
  Speech.stop();
  reading = id;
  const done = () => {
    if (reading === id) reading = null;
  };
  Speech.speak(toSpeech(markdown), { onDone: done, onStopped: done, onError: done });
}

export function stopReading() {
  reading = null;
  Speech.stop();
}
