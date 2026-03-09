const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

async function generateEmbeddings() {
  const manuals = JSON.parse(fs.readFileSync("./manual-rag.json", "utf-8"));

  for (let item of manuals) {
    const embedding = await client.embeddings.create({
      model: "text-embedding-v2",
      input: `${item.section} 意图: ${item.intent} 关键词: ${item.keywords.join(",")} 内容: ${item.content}`,
    });
    item.embedding = embedding.data[0].embedding;
  }

  fs.writeFileSync(
    "./manual-with-embeddings.json",
    JSON.stringify(manuals, null, 2),
  );
  console.log("完成，已生成带有 embeddings 的 manual-with-embeddings.json");
}

generateEmbeddings();
