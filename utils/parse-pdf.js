const path = require("path");
const fs = require("fs");
const pdf = require("pdf-parse");

async function processPDF() {
  const filePath = path.join(__dirname, "user_manual_1645887-T5_B.pdf");

  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);

  const clean = data.text
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  const chunks = splitByLength(clean, 400);

  const result = chunks.map((chunk, index) => ({
    id: index + 1,
    title: `Section ${index + 1}`,
    content: chunk,
  }));

  fs.writeFileSync("./manual.json", JSON.stringify(result, null, 2));

  console.log("完成，共生成", result.length, "段");
}

function splitByLength(text, maxLength = 400) {
  const chunks = [];
  let current = "";
  const paragraphs = text.split("\n");

  for (let p of paragraphs) {
    if ((current + p).length > maxLength) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += "\n" + p;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

processPDF();
