import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { keep, peek } from '@/lib/cache';

/** Stale-while-revalidate for one request: reloads on focus and pull, and `cache` shows the
 *  last answer at once, even after a relaunch. Deliberately small: no dedup, no retry. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], cache?: string) {
  const key = JSON.stringify(deps);
  const ck = cache && `${cache}:${key}`;
  const [data, setData] = useState<T | null>(() => (ck ? (peek<T>(ck) ?? null) : null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const seq = useRef(0);
  const shownKey = useRef(key);
  const load = useCallback(() => {
    const kept = ck ? peek<T>(ck) : undefined;
    if (kept !== undefined) setData(kept);
    else if (shownKey.current !== key) setData(null);
    shownKey.current = key;
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then(
        (d) => {
          if (my !== seq.current) return;
          setData(d);
          setError('');
          if (ck) keep(ck, d);
        },
        (e) => {
          if (my === seq.current) setError(String(e.message ?? e));
        },
      )
      .finally(() => {
        if (my !== seq.current) return;
        setLoading(false);
        setPulling(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ck]);
  useFocusEffect(load);
  // The refresh spinner shows only for a pull: one switched on at mount shifts iOS's list insets.
  const pull = {
    refreshing: pulling,
    onRefresh: () => {
      setPulling(true);
      load();
    },
  };
  return { data, error, loading, load, pull };
}
