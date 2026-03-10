const OpenAI = require("openai");
const { genId } = require("../utils/id");

let client = null;
function getClient() {
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is not configured");
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
  }

  return client;
}

const { searchManual } = require("./manualService");

/**
 * Phase 1：仅问答，不做设备控制建议/动作下发
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
6. 仅进行“解释/建议”问答，不输出任何可执行设备动作
7. 不做用户习惯学习、不做个性化画像推断
8. 永远使用【指定 JSON 协议】输出
9. 禁止输出 Markdown、代码块、解释性文字

【指定 JSON 协议】（仅 text）：
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

⚠️ 不允许返回 card、actions 或其它结构
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

function normalizeMessages(messages) {
  return messages
    .map((msg) => {
      // Phase 1 强制 text：即使模型漂移输出 card，也降级为可读文本
      if (msg && msg.type === "card") {
        const cardText = [msg.title, msg.reason]
          .filter(Boolean)
          .join("：")
          .trim();

        return {
          id: msg.id || genId(),
          role: "ai",
          type: "text",
          content: cardText || "请参考设备手册进行相关设置。",
        };
      }

      return {
        id: msg.id || genId(),
        role: "ai",
        type: "text",
        content: typeof msg?.content === "string" ? msg.content : "",
      };
    })
    .filter((msg) => msg.content);
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

  const completion = await getClient().chat.completions.create({
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

  parsed.messages = normalizeMessages(parsed.messages);

  if (parsed.messages.length === 0) {
    throw new Error("AI messages invalid");
  }

  console.log("✅ AI parsed messages:", parsed.messages);

  return parsed.messages;
}

module.exports = {
  handleChat,
};
