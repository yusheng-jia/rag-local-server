# AI Local Server

一个本地运行的智能卫浴设备问答服务，基于 DashScope 兼容的 OpenAI API。

## 功能
- 提供健康检查、服务信息、模型列表与聊天接口
- 结合用户手册向量检索（RAG）增强回答
- 严格的 JSON 输出协议，避免动作下发，只做说明与建议

## 快速开始

```bash
npm install
```

```bash
export DASHSCOPE_API_KEY=your_key_here
npm run dev
```

服务默认运行在 `http://localhost:3000`。

## 环境变量
- `DASHSCOPE_API_KEY`：DashScope 兼容 API Key（必需）
- `PORT`：服务端口（可选，默认 3000）

## API

- `GET /api/health`
- `GET /api/info`
- `GET /api/models`
- `POST /api/chat`

示例请求：

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "input": "我觉得坐圈有点烫，怎么调更舒适？",
    "context": {"mode":"standard","waterTemp":"high","seatHeat":"on","nightMode":true},
    "history": []
  }'
```

响应示例（仅 text）：

```json
{
  "code": 0,
  "data": {
    "messages": [
      {
        "id": "...",
        "role": "ai",
        "type": "text",
        "content": "..."
      }
    ]
  }
}
```

## 手册检索与评估

- 生成手册向量：

```bash
node utils/generate-manual-embeddings.js
```

- 检索评估：

```bash
npm run eval:retrieval
```

## 数据文件
- `manual-rag.json`：手册结构化内容
- `manual-with-embeddings.json`：带向量的手册数据
- `eval/retrieval-queries.json`：检索评估用例

## 开发提示
- 入口：`index.js`
- 路由：`routes/chat.js`
- 主要逻辑：`services/aiService.js`、`services/manualService.js`
- OpenAPI 说明：`httpie-openapi.yaml`
