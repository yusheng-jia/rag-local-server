const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

const rawManual = JSON.parse(
  fs.readFileSync("./manual-with-embeddings.json", "utf-8"),
);
const manual = rawManual.map((item) => {
  if (!Array.isArray(item.embedding)) return item;

  const norm = Math.sqrt(item.embedding.reduce((sum, v) => sum + v * v, 0));
  return {
    ...item,
    _norm: norm,
  };
});

console.log(
  "📚 已加载 manual-with-embeddings.json，包含",
  manual.length,
  "条内容",
);

function cosineSimilarity(a, b, normB) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const safeNormB = normB || Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (normA === 0 || safeNormB === 0) return 0;
  return dot / (normA * safeNormB);
}

function keywordBoost(question, item) {
  let boost = 0;

  for (let k of item.keywords || []) {
    if (question.includes(k)) {
      boost += 0.1;
    }
  }

  return boost;
}

async function searchManual(question) {
  if (!question || typeof question !== "string") {
    return null;
  }

  if (!process.env.DASHSCOPE_API_KEY) {
    return null;
  }

  const res = await client.embeddings.create({
    model: "text-embedding-v2",
    input: question,
  });

  const queryVector = res.data[0].embedding;

  let best = null;
  let bestScore = 0;

  for (let item of manual) {
    if (!item.embedding) continue;

    const score =
      cosineSimilarity(queryVector, item.embedding, item._norm) +
      keywordBoost(question, item);

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  console.log("📊 manual bestScore:", bestScore);

  if (bestScore > 0.82) {
    return best;
  }

  return null;
}

module.exports = {
  searchManual,
};
