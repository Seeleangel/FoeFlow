import type { EditorialSession } from './editorialTypes';
const stops: Record<string,string> = {
 no_progress:'没有新的证据或质量进展；已停止重复操作。', decision_budget_exhausted:'本轮决策预算已用尽；请补充信息或继续新一轮。', write_budget_exhausted:'本轮改写预算已用尽；请先核对未解决的验收项。', model_budget_exhausted:'模型调用预算已用尽；已保留当前检查点。', deadline_exceeded:'本轮时间预算已到；已保留候选稿。', invalid_json:'模型响应格式无效，且结构修复未成功。', task_plan_incomplete:'任务契约尚未完整，请明确目标、来源或验收要求。', model_or_tool_failed:'模型或素材工具失败；原确认稿未改变，可重试。', awaiting_editor_reply:'正在等待编辑补充具体缺口。', run_cancelled:'已取消本轮任务，候选与原确认稿已保留。', source_unavailable:'指定来源暂时无法读取，请补充来源或由编辑明确豁免。', blocked:'仍有未解决的交付阻断，请查看待补事项。', confirmation_without_pending:'当前没有待确认的问题；请补充具体要求后继续，或取消本轮。', already_confirmed:'成稿已确认；如需修改请直接说明新的修改要求。'
};
export function editorialStopExplanation(s: EditorialSession): string {
 if (s.lastRun?.stop) { const stop = s.lastRun.stop; return stop.headline + (stop.detail ? '：' + stop.detail : ''); }
 if (s.lastStop) {
  const text = stops[s.lastStop.code] ?? (s.lastStop.code.startsWith('fixture_error:') ? '模拟响应缺失；未使用真实模型补齐。' : '本轮已保留检查点，未达到交付条件（' + s.lastStop.code + '）。');
  const detail = s.lastStop.code === 'model_or_tool_failed' ? s.lastStop.nextActions.find(item => item && item !== text) : undefined;
  return detail ? text + '原因：' + detail : text;
 }
 return ({planning:'正在明确任务契约',gathering:'正在读取素材',writing:'候选稿尚未完成同版验收',reviewing:'正在审稿',waiting_input:'正在等待编辑补充',pending_confirmation:'待你确认成稿',confirmed:'已确认成稿',incomplete:'候选稿尚未满足交付条件',failed:'本轮失败；原确认稿未改变'})[s.phase];
}
