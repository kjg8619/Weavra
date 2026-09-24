import { createServer } from "node:http";

/** Text of an OpenAI chat message (string or content parts). */
export function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

/**
 * Loopback OpenAI-compatible chat completions peer for integration tests. `respond` gets the parsed worker
 * request (the first user message is the Runtime's JSON request), tool names and messages, and returns
 * `{ tool, args }` or `{ text }`. Every response reports usage so the Runtime's budget stays known.
 */
export async function startScriptedModel(respond) {
  const requests = [];
  const server = createServer(async (incoming, response) => {
    if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions") {
      response.writeHead(404);
      response.end();
      return;
    }
    let raw = "";
    for await (const chunk of incoming) raw += chunk;
    const body = JSON.parse(raw);
    const messages = body.messages ?? [];
    let request;
    try {
      request = JSON.parse(messageText(messages.find((message) => message.role === "user")));
    } catch {
      request = undefined;
    }
    const tools = (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean);
    const toolResults = messages.filter((message) => message.role === "tool");
    const entry = { request, tools, messages, toolResults, system: messageText(messages.find((m) => m.role === "system")) };
    requests.push({ role: request?.role, step: request?.step, complexTaskId: request?.complexTask?.task.id ?? null, tools, toolResults: toolResults.length });
    let reply;
    try {
      reply = await respond(entry);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error?.message ?? error) } }));
      return;
    }
    const id = `chatcmpl-${requests.length}`;
    const chunk = (choice, extra = {}) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "fixture", choices: choice ? [choice] : [], ...extra })}\n\n`;
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    if (reply.tool) {
      response.write(
        chunk({
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              { index: 0, id: `call_${requests.length}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } },
            ],
          },
          finish_reason: null,
        }),
      );
      response.write(chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }));
    } else {
      response.write(chunk({ index: 0, delta: { role: "assistant", content: reply.text }, finish_reason: null }));
      response.write(chunk({ index: 0, delta: {}, finish_reason: "stop" }));
    }
    response.write(chunk(undefined, { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }));
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
