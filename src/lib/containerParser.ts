/**
 * Container Parser for FOE Publicity
 *
 * Parses custom container syntax similar to wewrite's container blocks:
 * - :::dialogue ... :::  → Dialogue/conversation block
 * - :::timeline ... :::  → Timeline block
 * - :::callout type ... ::: → Callout box (tip/warning/info/danger)
 * - :::quote ... ::: → Blockquote
 *
 * Converts these to HTML with class names for theme styling.
 */

export interface ContainerBlock {
  type: 'dialogue' | 'timeline' | 'callout' | 'quote';
  content: string;
  variant?: string; // For callout: tip, warning, info, danger
}

/**
 * Parse container blocks from markdown text.
 * Returns the text with containers replaced by placeholders,
 * and an array of parsed containers.
 */
export function parseContainers(text: string): {
  parsedText: string;
  containers: ContainerBlock[];
} {
  const containers: ContainerBlock[] = [];
  let parsedText = text;

  // Pattern: :::type\n...\n:::
  const containerRegex = /:::(\w+)(?:\s+(\w+))?\n([\s\S]*?)\n:::/g;

  let match;
  let index = 0;

  while ((match = containerRegex.exec(text)) !== null) {
    const type = match[1] as ContainerBlock['type'];
    const variant = match[2];
    const content = match[3].trim();

    // Validate container type
    if (!['dialogue', 'timeline', 'callout', 'quote'].includes(type)) {
      continue;
    }

    containers.push({
      type,
      content,
      variant,
    });

    // Replace with placeholder
    const placeholder = `%%CONTAINER_${index}%%`;
    parsedText = parsedText.replace(match[0], placeholder);
    index++;
  }

  return { parsedText, containers };
}

/**
 * Convert a container block to HTML.
 */
export function containerToHtml(container: ContainerBlock): string {
  switch (container.type) {
    case 'dialogue':
      return renderDialogue(container.content);
    case 'timeline':
      return renderTimeline(container.content);
    case 'callout':
      return renderCallout(container.content, container.variant);
    case 'quote':
      return renderQuote(container.content);
    default:
      return `<div class="container">${container.content}</div>`;
  }
}

/**
 * Render dialogue container.
 * Format: Each line starting with ">" is a response, others are questions.
 */
function renderDialogue(content: string): string {
  const lines = content.split('\n');
  const items = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      return `<div class="dialogue-response">${trimmed.slice(1).trim()}</div>`;
    } else if (trimmed) {
      return `<div class="dialogue-question">${trimmed}</div>`;
    }
    return '';
  }).filter(Boolean);

  return `<div class="container container-dialogue">${items.join('')}</div>`;
}

/**
 * Render timeline container.
 * Format: "**time** event" or "**time** event\n**time** event"
 */
function renderTimeline(content: string): string {
  const lines = content.split('\n').filter((line) => line.trim());
  const items = lines.map((line) => {
    const trimmed = line.trim();
    // Match **bold** text pattern
    const match = trimmed.match(/^\*\*(.+?)\*\*\s*(.+)$/);
    if (match) {
      return `<div class="timeline-item"><span class="timeline-time">${match[1]}</span><span class="timeline-event">${match[2]}</span></div>`;
    }
    return `<div class="timeline-item">${trimmed}</div>`;
  });

  return `<div class="container container-timeline">${items.join('')}</div>`;
}

/**
 * Render callout container.
 * Variants: tip, warning, info, danger
 */
function renderCallout(content: string, variant?: string): string {
  const type = variant || 'info';
  const icons: Record<string, string> = {
    tip: '💡',
    warning: '⚠️',
    info: 'ℹ️',
    danger: '🚫',
  };

  const icon = icons[type] || icons.info;
  return `<div class="container container-callout container-callout-${type}"><span class="callout-icon">${icon}</span><div class="callout-content">${content}</div></div>`;
}

/**
 * Render quote container.
 */
function renderQuote(content: string): string {
  return `<div class="container container-quote"><blockquote>${content}</blockquote></div>`;
}

/**
 * Replace container placeholders with HTML.
 */
export function replaceContainers(text: string, containers: ContainerBlock[]): string {
  let result = text;

  containers.forEach((container, index) => {
    const placeholder = `%%CONTAINER_${index}%%`;
    const html = containerToHtml(container);
    result = result.replace(placeholder, html);
  });

  return result;
}

/**
 * Full pipeline: parse containers, process text, replace containers.
 * Returns the processed markdown with containers converted to HTML.
 */
export function processContainers(text: string): string {
  const { parsedText, containers } = parseContainers(text);
  return replaceContainers(parsedText, containers);
}

/**
 * Convert all containers in text to HTML inline.
 * This is the main export for use in htmlBuilder.
 */
export function transformContainers(markdownText: string): string {
  return processContainers(markdownText);
}
