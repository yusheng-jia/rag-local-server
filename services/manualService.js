const fs = require("fs");
const OpenAI = require("openai");

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

const SOFT_QUERY_TERMS = [
  "请问",
  "一下",
  "如何",
  "怎么",
  "怎样",
  "可以",
  "吗",
  "呢",
  "呀",
  "啊",
  "我想",
  "想问",
];

const DEFAULT_MIN_SCORE = 0.68;
const KEYWORD_ASSIST_MIN_SCORE = 0.58;
const KEYWORD_STRONG_HIT = 0.16;

function normalizeText(text) {
  if (!text || typeof text !== "string") return "";

  let value = text.toLowerCase();
  value = value.replace(/[，。！？、,.!?;；:："'`~@#$%^&*()（）【】\[\]{}<>《》\s]/g, "");

  for (const term of SOFT_QUERY_TERMS) {
    value = value.replaceAll(term, "");
  }

  return value;
}

function makeBigrams(text) {
  if (!text || text.length < 2) return new Set();

  const grams = new Set();
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;

  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const rawManual = JSON.parse(
  fs.readFileSync("./manual-with-embeddings.json", "utf-8"),
);
const manual = rawManual.map((item) => {
  const normalizedKeywords = (item.keywords || []).map((k) => normalizeText(k));
  const normalizedSection = normalizeText(item.section || "");
  const normalizedIntent = normalizeText(item.intent || "");
  const keywordCorpus = normalizeText(
    `${(item.keywords || []).join("")}${item.section || ""}${item.intent || ""}`,
  );

  if (!Array.isArray(item.embedding)) return item;

  const norm = Math.sqrt(item.embedding.reduce((sum, v) => sum + v * v, 0));
  return {
    ...item,
    _norm: norm,
    _normalizedKeywords: normalizedKeywords,
    _normalizedSection: normalizedSection,
    _normalizedIntent: normalizedIntent,
    _keywordBigrams: makeBigrams(keywordCorpus),
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

function keywordBoost(normalizedQuestion, item) {
  let boost = 0;

  for (let k of item._normalizedKeywords || []) {
    if (!k) continue;

    if (normalizedQuestion.includes(k)) {
      boost += 0.18;
      continue;
    }

    // 允许关键词被虚词打断，例如“遥控器如何连接”匹配“遥控器连接”
    const hitByParts =
      k.length >= 4 &&
      normalizedQuestion.includes(k.slice(0, 2)) &&
      normalizedQuestion.includes(k.slice(-2));

    if (hitByParts) {
      boost += 0.1;
    }
  }

  if (item._normalizedSection && normalizedQuestion.includes(item._normalizedSection)) {
    boost += 0.06;
  }

  if (item._normalizedIntent && normalizedQuestion.includes(item._normalizedIntent)) {
    boost += 0.04;
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

  const res = await getClient().embeddings.create({
    model: "text-embedding-v2",
    input: question,
  });

  const queryVector = res.data[0].embedding;
  const result = rankManualByVector(question, queryVector);
  return result.best;
}

function rankManualByVector(question, queryVector) {
  const normalizedQuestion = normalizeText(question);
  const queryBigrams = makeBigrams(normalizedQuestion);

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKeywordBoost = 0;
  const scored = [];

  for (let item of manual) {
    if (!item.embedding) continue;

    const semanticScore = cosineSimilarity(queryVector, item.embedding, item._norm);
    const kwBoost = keywordBoost(normalizedQuestion, item);
    const lexicalScore = jaccard(queryBigrams, item._keywordBigrams || new Set()) * 0.2;
    const priorityBoost = (Number(item.priority) || 0) * 0.01;
    const score = semanticScore + kwBoost + lexicalScore + priorityBoost;

    scored.push({
      id: item.id,
      score,
      semanticScore,
      kwBoost,
      lexicalScore,
    });

    if (score > bestScore) {
      bestScore = score;
      best = item;
      bestKeywordBoost = kwBoost;
    }
  }

  const ranked = scored.sort((a, b) => b.score - a.score);
  const top3 = ranked.slice(0, 3)
    .map((x) => ({
      id: x.id,
      score: Number(x.score.toFixed(4)),
      semantic: Number(x.semanticScore.toFixed(4)),
      keyword: Number(x.kwBoost.toFixed(4)),
      lexical: Number(x.lexicalScore.toFixed(4)),
    }));

  console.log("📊 manual top3:", top3);

  const accepted =
    bestScore >= DEFAULT_MIN_SCORE ||
    (bestKeywordBoost >= KEYWORD_STRONG_HIT && bestScore >= KEYWORD_ASSIST_MIN_SCORE);

  return {
    accepted,
    best: accepted ? best : null,
    bestCandidate: best,
    bestScore,
    bestKeywordBoost,
    ranked,
    top3,
  };
}

async function rankManual(question) {
  if (!question || typeof question !== "string") {
    return {
      accepted: false,
      best: null,
      bestCandidate: null,
      bestScore: Number.NEGATIVE_INFINITY,
      bestKeywordBoost: 0,
      ranked: [],
      top3: [],
    };
  }

  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is not configured");
  }

  const res = await getClient().embeddings.create({
    model: "text-embedding-v2",
    input: question,
  });

  const queryVector = res.data[0].embedding;
  return rankManualByVector(question, queryVector);
}

module.exports = {
  rankManual,
  searchManual,
};
