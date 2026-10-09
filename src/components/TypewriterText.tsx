import { useTypewriter } from '@/hooks/useTypewriter';

interface TypewriterTextProps {
  text: string;
  onUpdate?: () => void;
}

export default function TypewriterText({ text = '', onUpdate }: TypewriterTextProps) {
  const displayed = useTypewriter(text, { onUpdate });
  const done = displayed.length >= text.length;

  return (
    <>
      {displayed}
      {!done && <span className="animate-pulse">|</span>}
    </>
  );
}
