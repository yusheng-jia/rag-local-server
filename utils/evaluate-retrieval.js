const fs = require("fs");
const path = require("path");
const { rankManual } = require("../services/manualService");

function loadCases(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf-8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("evaluation file must be an array");
  }

  return data.map((item, index) => {
    if (!item.query || !Array.isArray(item.expected_ids) || item.expected_ids.length === 0) {
      throw new Error(`invalid case at index ${index}`);
    }

    return {
      query: item.query,
      expectedIds: item.expected_ids,
    };
  });
}

async function run() {
  const filePath = process.argv[2] || "./eval/retrieval-queries.json";
  const cases = loadCases(filePath);

  let top1Hit = 0;
  let top3Hit = 0;
  let acceptedHit = 0;
  const failed = [];

  for (const testCase of cases) {
    const result = await rankManual(testCase.query);
    const top3Ids = result.top3.map((x) => x.id);
    const top1Id = top3Ids[0] || null;
    const expected = new Set(testCase.expectedIds);
    const isTop1Hit = top1Id ? expected.has(top1Id) : false;
    const isTop3Hit = top3Ids.some((id) => expected.has(id));
    const isAcceptedHit = result.best ? expected.has(result.best.id) : false;

    if (isTop1Hit) top1Hit += 1;
    if (isTop3Hit) top3Hit += 1;
    if (isAcceptedHit) acceptedHit += 1;

    if (!isTop3Hit) {
      failed.push({
        query: testCase.query,
        expected: testCase.expectedIds,
        top3: top3Ids,
        accepted: result.best ? result.best.id : null,
      });
    }
  }

  const total = cases.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

  console.log("=== Retrieval Evaluation ===");
  console.log(`cases: ${total}`);
  console.log(`top1 hit: ${top1Hit}/${total} (${pct(top1Hit)})`);
  console.log(`top3 hit: ${top3Hit}/${total} (${pct(top3Hit)})`);
  console.log(`accepted hit: ${acceptedHit}/${total} (${pct(acceptedHit)})`);

  if (failed.length > 0) {
    console.log("\n=== Missed Cases (Top3) ===");
    for (const item of failed) {
      console.log(`- query: ${item.query}`);
      console.log(`  expected: ${item.expected.join(", ")}`);
      console.log(`  top3: ${item.top3.join(", ") || "(none)"}`);
      console.log(`  accepted: ${item.accepted || "(none)"}`);
    }
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("evaluation failed:", err.message);
  process.exit(1);
});
