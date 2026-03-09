const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const chatRouter = require("./routes/chat");

const app = express();

app.use(cors());
app.use(bodyParser.json());

const SUPPORTED_MODELS = [
  {
    id: "qwen-plus",
    provider: "dashscope-compatible",
    features: ["chat"],
  },
  {
    id: "text-embedding-v2",
    provider: "dashscope-compatible",
    features: ["embedding"],
  },
];

app.get("/api/health", (req, res) => {
  res.json({
    code: 0,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

app.get("/api/info", (req, res) => {
  res.json({
    code: 0,
    data: {
      name: "AI Local Server",
      version: "1.0.0",
      description: "Local AI chat server",
      endpoints: [
        "GET /api/health",
        "GET /api/info",
        "GET /api/models",
        "POST /api/chat",
      ],
    },
  });
});

app.get("/api/models", (req, res) => {
  res.json({
    code: 0,
    data: {
      models: SUPPORTED_MODELS,
    },
  });
});

app.use("/api/chat", chatRouter);

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  res.status(500).json({
    code: 500,
    message: "server error",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.warn(
      "⚠️ DASHSCOPE_API_KEY is not set. /api/chat will fail until the key is configured.",
    );
  }
  console.log(`✅ AI server running at http://localhost:${PORT}`);
});
