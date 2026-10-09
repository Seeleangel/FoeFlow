import { useState, useEffect } from 'react';

/**
 * Rotates through an array of messages at a fixed interval.
 * Resets when `stage` changes, so each pipeline phase gets its own message set.
 * Returns [message, index] — use index as part of the element `key` to trigger transition animations.
 */
export function useRotatingMessage(
  messages: string[],
  stage: string,
  intervalMs = 6000
): [string, number] {
  const [index, setIndex] = useState(0);

  // Reset to first message when stage changes
  useEffect(() => {
    setIndex(0);
  }, [stage]);

  // Rotate through messages
  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [stage, intervalMs, messages.length]);

  return [messages[index] || '', index];
}
