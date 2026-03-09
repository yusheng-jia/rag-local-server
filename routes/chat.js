const express = require("express");
const router = express.Router();

const { handleChat } = require("../services/aiService");

router.post("/", async (req, res) => {
  try {
    const { input, context, history } = req.body;

    if (!input) {
      return res.status(400).json({
        code: 400,
        message: "input is required",
      });
    }

    const messages = await handleChat({
      input,
      context,
      history,
    });

    res.json({
      code: 0,
      data: {
        messages,
      },
    });
  } catch (err) {
    console.error(err);

    if (err.message === "DASHSCOPE_API_KEY is not configured") {
      return res.status(500).json({
        code: 500,
        message: "DASHSCOPE_API_KEY is not configured",
      });
    }

    if (err.message === "AI response format error") {
      return res.status(502).json({
        code: 502,
        message: "ai response format error",
      });
    }

    res.status(500).json({
      code: 500,
      message: "server error",
    });
  }
});

module.exports = router;
