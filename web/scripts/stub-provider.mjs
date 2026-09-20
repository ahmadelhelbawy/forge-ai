/**
 * Minimal OpenAI-compatible stub for product E2E (started by e2e.sh).
 *
 * - GET /models returns a fixed list (discovery path).
 * - POST /chat/completions requires `Bearer test-key-123`, else 401
 *   (authentication-failure path). Model id "nope" yields 404.
 * - Chat replies carry the FORGE JSON envelope with no prompt change.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 3220);
const GOOD_KEY = "test-key-123";

const server = http.createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/models") {
    json(200, { data: [{ id: "stub-model-a" }, { id: "kimi-k3" }] });
    return;
  }
  if (req.method === "POST" && req.url === "/chat/completions") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
        json(401, { error: { message: "Invalid API key" } });
        return;
      }
      let model = "";
      try {
        model = JSON.parse(raw).model ?? "";
      } catch {
        model = "";
      }
      if (model === "nope") {
        json(404, { error: { message: "model nope does not exist" } });
        return;
      }
      json(200, {
        id: "stub-1",
        model,
        choices: [{ message: { content: '{"reply":"stub says hi","prompt":null}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });
    });
    return;
  }
  json(404, { error: { message: "not found" } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub provider on ${PORT}`);
});
