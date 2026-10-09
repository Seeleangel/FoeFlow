export function stripCodeBlocks(content: string): string {
  const match = content.match(/^```[\w]*\n?([\s\S]*?)\n?```$/m);
  return match ? match[1].trim() : content.trim();
}

export function removeEmoji(text: string): string {
  return text
    .replace(/\p{Emoji}/gu, (match) => {
      const cp = match.codePointAt(0)!;
      return cp >= 0x80 ? '' : match;
    })
    .replace(/️/g, '')
    .replace(/  +/g, ' ')
    .trim();
}
