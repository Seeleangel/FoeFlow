export function isArticle(text: string): boolean {
  const trimmed = text.trimStart();
  // 必须以标题开头
  if (!trimmed.startsWith('# ')) return false;
  // 必须包含至少两个段落（标题 + 正文），避免单行标题被误判
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  return lines.length >= 2;
}
