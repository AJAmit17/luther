import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

/** Hold to talk: start on press, stop on release; onDone gets the final
 *  transcript. Recognition runs on the phone (iOS Speech). */
export function useVoice(onDone: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const latest = useRef('');
  const released = useRef(false); // let go before recognition started
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useSpeechRecognitionEvent('start', () => {
    if (released.current) ExpoSpeechRecognitionModule.stop();
  });
  useSpeechRecognitionEvent('result', (e) => {
    latest.current = e.results[0]?.transcript ?? '';
    setHeard(latest.current);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    const t = latest.current.trim();
    latest.current = '';
    setHeard('');
    if (t) done.current(t);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    if (e.error !== 'aborted' && e.error !== 'no-speech' && e.error !== 'speech-timeout') Alert.alert("Couldn't listen", e.message);
  });

  const start = async () => {
    released.current = false;
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) {
      Alert.alert('Microphone or speech access is off', 'Turn both on for Luther in Settings to talk to your agents.');
      return;
    }
    if (released.current) return; // the permission sheet ate the hold
    latest.current = '';
    setListening(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ExpoSpeechRecognitionModule.start({ interimResults: true, addsPunctuation: true });
  };
  const stop = () => {
    released.current = true;
    if (listening) ExpoSpeechRecognitionModule.stop();
  };
  return { listening, heard, start, stop };
}
