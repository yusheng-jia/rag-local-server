const OpenAI = require("openai");
const { genId } = require("../utils/id");

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

const { searchManual } = require("./manualService");

/**
 * 系统 Prompt：这是整个 AI 行为的“宪法”
 */
const SYSTEM_PROMPT = `
你是【某品牌智能卫浴设备】的 AI 使用顾问，主要服务对象是【智能马桶】用户。

你的职责：
- 解答设备使用、设置、舒适度、节能、维护相关问题
- 基于当前设备状态给出合理建议
- 回答必须专业、克制、可靠，不夸大、不恐吓、不推销

设备能力（不可超出）：
- 冲洗模式：柔和 / 标准 / 强力
- 水温：低 / 中 / 高
- 座圈加热：开 / 关
- 夜间模式：支持

你必须遵守的规则：
1. 只回答与设备相关的问题
2. 不推荐设备不支持的功能
3. 不编造故障原因
4. 不给出维修拆机或内部结构建议
5. 不输出任何与设备无关的内容
6. 永远使用【指定 JSON 协议】输出
7. 禁止输出 Markdown、代码块、解释性文字

什么时候使用 card：
- 用户询问：是否合适、是否费电、怎么调、推荐设置、维护建议
- 用户反馈：不舒服、效果不好、担心耗电
- 需要给出【建议 + 原因 + 可执行操作】时

什么时候使用 text：
- 简单解释
- 状态确认
- 已执行操作反馈
- 无需立即调整设备参数的情况

card 的 action 规则：
- action.key 必须来自以下集合：
  - set_mode_soft
  - set_mode_standard
  - set_mode_strong
  - temp_down
  - temp_up
  - seat_heat_off
  - seat_heat_on
  - night_mode_on
  - night_mode_off
- 如果不需要立即执行设备操作，可以不返回 actions

【指定 JSON 协议】：

文本消息：
{
  "messages": [
    {
      "id": "string",
      "role": "ai",
      "type": "text",
      "content": "string"
    }
  ]
}

卡片消息：
{
  "messages": [
    {
      "id": "string",
      "role": "ai",
      "type": "card",
      "title": "string",
      "status": ["string"],
      "reason": "string",
      "actions": [
        { "key": "string", "text": "string" }
      ]
    }
  ]
}

⚠️ 不允许返回其它结构
`;

/**
 * 构建给大模型的 messages
 */
function buildMessages({ input, context, history, extraSystem }) {
  const messages = [];

  messages.push({
    role: "system",
    content: SYSTEM_PROMPT,
  });

  if (extraSystem) {
    messages.push({
      role: "system",
      content: extraSystem,
    });
  }

  if (context) {
    messages.push({
      role: "system",
      content: `当前设备状态（仅供参考）：${JSON.stringify(context)}`,
    });
  }

  if (Array.isArray(history)) {
    history.forEach((msg) => {
      if (!msg.role || !msg.content) return;

      // 🔥 关键：角色映射
      let role = msg.role;
      if (role === "ai") role = "assistant";
      if (role === "user") role = "user";

      // 只允许合法角色进入模型
      if (["system", "user", "assistant"].includes(role)) {
        messages.push({
          role,
          content: msg.content,
        });
      }
    });
  }

  messages.push({
    role: "user",
    content: input,
  });

  console.log("📨 Built messages for AI:", messages);

  return messages;
}

function parseModelJson(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("AI response is empty");
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    // 兼容模型偶发输出 ```json ... ``` 的情况
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!codeBlockMatch) {
      throw new Error("AI response format error");
    }

    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch (nestedErr) {
      throw new Error("AI response format error");
    }
  }
}

/**
 * 核心方法：给 router 调用
 */
async function handleChat({ input, context, history }) {
  console.log("🤖 AI handleChat input:", input);

  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is not configured");
  }

  const manualHit = await searchManual(input);

  let manualPrompt = "";
  if (manualHit) {
    console.log("📘 命中手册:", manualHit.id);

    manualPrompt = `
      以下是官方用户手册内容，仅在与问题相关时使用：

      【${manualHit.section}】
      ${manualHit.content}

      要求：
      1. 只基于以上内容回答
      2. 提炼重点，不要整段复制
      3. 如果内容不足，可以保持谨慎说明
      `;
  }

  const completion = await client.chat.completions.create({
    model: "qwen-plus",
    temperature: 0.3,
    messages: buildMessages({
      input,
      context,
      history,
      extraSystem: manualPrompt,
    }),
  });

  const raw = completion.choices[0].message.content;

  console.log("🧠 AI raw response:", raw);

  const parsed = parseModelJson(raw);

  if (!parsed.messages || !Array.isArray(parsed.messages)) {
    throw new Error("AI messages invalid");
  }

  // 给 message 自动补 id（防止前端炸）
  parsed.messages = parsed.messages.map((msg) => ({
    id: msg.id || genId(),
    role: "ai",
    ...msg,
  }));

  console.log("✅ AI parsed messages:", parsed.messages);

  return parsed.messages;
}

module.exports = {
  handleChat,
};
