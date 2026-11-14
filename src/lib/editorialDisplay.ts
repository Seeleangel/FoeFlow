/** Editor-facing labels. Internal codes stay in secondary/diagnostic lines only. */
import type { Gap } from './editorialTypes';

export const GAP_STATE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  open: '待补充', asked: '已询问', answered: '已回答', needs_clarification: '待澄清',
  resolved: '已解决', resolved_for_gate: '编辑已确认继续', waived: '已豁免', deferred_by_editor: '编辑选择按现有信息继续',
  pending_check: '待检查', unmet: '未满足', blocked_by_constraint: '改写预算已用尽',
});

export const RULE_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  length: '篇幅', semantic: '内容', include_facts: '必须包含的事实', exclude_claims: '不得出现的内容',
  preserve_blocks: '保留原有段落', permission: '授权', source_read: '来源',
});

export const PERMISSION_CHANNEL_LABEL: Readonly<Record<string, string>> = Object.freeze({ public: '公开', internal: '内部', private: '私有' });
export const PERMISSION_IDENTITY_LABEL: Readonly<Record<string, string>> = Object.freeze({ named: '具名', anonymous: '匿名', not_applicable: '不适用' });
export const PERMISSION_STATE_LABEL: Readonly<Record<string, string>> = Object.freeze({ allowed: '已授权', denied: '已拒绝', unknown: '待确认', withdrawn: '已撤回' });
export const ASSET_STATE_LABEL: Readonly<Record<string, string>> = Object.freeze({ included: '已使用', placeholder: '占位', omitted: '已省略' });
export const PERMISSION_USE_LABEL: Readonly<Record<string, string>> = Object.freeze({ publication: '公开发布', public: '公开发布', internal: '内部使用', private: '内部使用', promotion: '推广', illustration: '配图', quotation: '引用' });

export function hasCjk(text: string): boolean {
  return /[㐀-鿿]/.test(text);
}

export function gapStateLabel(state: string): string {
  return GAP_STATE_LABEL[state] ?? state;
}

function permissionUseLabel(value: string): string {
  return PERMISSION_USE_LABEL[value] ?? value;
}

function channelLabel(value: string): string {
  return PERMISSION_CHANNEL_LABEL[value] ?? value;
}

function identityLabel(value: string): string {
  return PERMISSION_IDENTITY_LABEL[value] ?? value;
}

/** Old sessions persisted English permission tokens in the reason; normalise them at render time. */
export function formatGapReason(gap: Gap): string {
  const reason = (gap.reason ?? '').trim();
  if (!reason) return gap.label;
  const normalized = reason
    .replace(/用途：([^；;，,]+)/g, (_, value: string) => '用途：' + permissionUseLabel(value.trim()))
    .replace(/渠道：([^；;，,]+)/g, (_, value: string) => '渠道：' + channelLabel(value.trim()))
    .replace(/身份：([^；;，,]+)/g, (_, value: string) => '身份：' + identityLabel(value.trim()));
  return hasCjk(normalized) ? normalized : '需要编辑确认：' + gap.label;
}

export interface ConstraintDisplay { label: string; detail: string; technical?: string }

/** One actionable line per unmet constraint; raw English detail only inside the technical disclosure. */
export function formatConstraint(gap: Gap): ConstraintDisplay {
  const kind = gap.selector.predicate;
  const label = (RULE_KIND_LABEL[kind] ?? '验收') + '要求';
  const measurement = gap.measurement;
  if (measurement?.detail && /要求/.test(measurement.detail) && /实测/.test(measurement.detail)) return { label, detail: measurement.detail };
  if (measurement && (measurement.measured !== undefined || measurement.required !== undefined)) {
    return { label, detail: '实测 ' + (measurement.measured ?? '未测') + '，要求 ' + (measurement.required ?? '未设置') };
  }
  const gate = formatGateDetail(gap.reason, kind);
  return { label, detail: gate.text, ...(gate.technical ? { technical: gate.technical } : {}) };
}

export function formatGateDetail(detail: string | undefined, kind: string): { text: string; technical?: string } {
  const label = RULE_KIND_LABEL[kind] ?? '验收';
  const fallback = '未满足' + label + '要求';
  const text = (detail ?? '').trim();
  if (!text) return { text: fallback };
  return { text: fallback, technical: text };
}
