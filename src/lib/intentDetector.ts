import { callAI } from './ai';

export type WritingIntent = 'generate_article' | 'chat';

export async function detectWritingIntent(
  userMessage: string,
  conversationHistory: string,
  pipelineStage?: string | null
): Promise<WritingIntent> {
  try {
    const stageHint = pipelineStage
      ? `\n注意：用户当前正处于文章生成流程的"${pipelineStage}"阶段，他们接下来发的消息更可能是修改建议或确认，而非从头重新生成文章。`
      : '';

    const prompt = `根据用户最新消息和对话历史，判断用户是否要求生成一篇完整的公众号文章。

【分类标准】
- generate_article：用户明确要求基于对话内容从头生成、撰写、输出一篇完整的公众号/推文/文章。典型表达："帮我写篇推文"、"生成一篇文章"、"基于以上内容出篇推文"。
- chat：用户在闲聊、提出具体修改建议（如改词、加段、删句、调整语气、换例子）、问问题、讨论内容细节、或要求润色已有内容。不要求从头生成完整文章。${stageHint}

【示例】
- "帮我写篇推文" → generate_article
- "把守夜人改成城市清洁工" → chat（修改建议）
- "加一段结语" → chat（修改建议）
- "这段太长，缩短一点" → chat（修改建议）
- "语气改得活泼一点" → chat（修改建议）
- "你觉得这个选题怎么样" → chat（闲聊/问问题）

用户消息：${userMessage}
对话历史：${conversationHistory || '无'}

请只回复 generate_article 或 chat，不要解释。`;

    const response = await callAI({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    const intent = response.content.trim().toLowerCase();
    return intent.includes('generate') ? 'generate_article' : 'chat';
  } catch (error) {
    console.error('[detectWritingIntent] Failed:', error);
    return 'chat';
  }
}
