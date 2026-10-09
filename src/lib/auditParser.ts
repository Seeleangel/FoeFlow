import type { AuditIssue } from '@/types';

function repairUnescapedQuotes(json: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        // 开始字符串
        inString = true;
        result += char;
        continue;
      }

      // 尝试判断这个 " 是字符串结束还是内容中的未转义引号
      // 向后查找第一个非空白字符
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) {
        j++;
      }
      const nextChar = json[j];

      // 如果后面紧跟结构字符，说明是合法的字符串结束符
      if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']') {
        inString = false;
        result += char;
      } else {
        // 未转义的引号，替换为中文引号
        result += '」';
      }
      continue;
    }

    result += char;
  }

  return result;
}

export function parseAuditResult(raw: string): AuditIssue[] {
  // 1. 尝试提取最外层 JSON 数组（兼容前后有废话或 markdown 的情况）
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  const candidate = arrayMatch ? arrayMatch[0] : raw;

  // 2. 清理 markdown 代码块标记
  const cleaned = candidate
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  // 3. 解析 JSON，先尝试原样解析，失败后做引号修复再试
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      const repaired = repairUnescapedQuotes(cleaned);
      parsed = JSON.parse(repaired);
    } catch {
      const preview = raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
      return [
        {
          dimension: 'text',
          severity: 'low',
          message: `AI 返回格式异常，无法解析结构化结果。原始响应：${preview}`,
          suggestion: '请检查 API 响应或手动核对原文',
        },
      ];
    }
  }

  if (Array.isArray(parsed)) {
    const issues = parsed.map((item) => ({
      dimension: item.dimension || 'text',
      severity: item.severity || 'low',
      message: item.message || '',
      suggestion: item.suggestion || '',
      location: item.location,
    }));
    // 过滤掉自相矛盾的 issue（LLM 分析后确认无误但仍输出的条目）
    const selfContradictKeywords = [
      '无需修改', '计算无误', '此处无误', '核实无误', '经复核', '经仔细核算',
      '计算正确', '无错误', '不存在问题', '没有问题', '并非错误', '不是错误',
    ];
    return issues.filter((issue) => {
      const text = `${issue.message} ${issue.suggestion}`.toLowerCase();
      return !selfContradictKeywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }
  return [];
}
