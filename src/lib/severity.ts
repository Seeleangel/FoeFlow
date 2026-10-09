export const SEVERITY_COLORS: Record<string, string> = {
  high: 'text-red-600 bg-red-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-blue-600 bg-blue-50',
  pass: 'text-green-600 bg-green-50',
};

export const SEVERITY_LABELS: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  pass: '通过',
};

export function getSeverityColor(severity: string): string {
  return SEVERITY_COLORS[severity] || 'text-stone-600 bg-stone-50';
}

export function getSeverityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] || severity;
}
