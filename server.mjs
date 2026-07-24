import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const model = "gemini-3.6-flash";

await loadEnvFile();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ready: Boolean(process.env.GEMINI_API_KEY),
        model
      });
    }

    if (request.method === "POST" && url.pathname === "/api/reconcile") {
      return await handleReconcile(request, response);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed." });
    }

    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    if (relative.split(/[\\/]/).some(segment => segment.startsWith("."))) {
      return sendJson(response, 404, { error: "Not found." });
    }
    const safeRelative = normalize(relative).replace(/^(\.\.(\\|\/|$))+/, "");
    const filePath = join(root, safeRelative);
    if (!filePath.startsWith(root)) return sendJson(response, 403, { error: "Forbidden." });

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error?.code === "ENOENT") return sendJson(response, 404, { error: "Not found." });
    console.error("[SRX]", error);
    return sendJson(response, error?.statusCode || 500, { error: "SRX could not complete the request." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SRX is running at http://127.0.0.1:${port}`);
  console.log(`Reconciliation model: ${model}`);
});

async function handleReconcile(request, response) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: "GEMINI_API_KEY is not configured. Add it to .env and restart SRX."
    });
  }

  const payload = JSON.parse(await readBody(request));
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return sendJson(response, 400, { error: "A non-empty messages array is required." });
  }

  const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: toGeminiContents(payload.messages),
      generationConfig: {
        responseMimeType: "application/json"
      }
    })
  });

  const raw = await geminiResponse.text();
  if (!geminiResponse.ok) {
    console.error(`[SRX · Gemini ${geminiResponse.status}]`, raw);
    return sendJson(response, geminiResponse.status, {
      error: "Gemini could not complete the reconciliation request."
    });
  }

  const data = JSON.parse(raw);
  return sendJson(response, 200, {
    choices: [{ message: { content: extractGeminiText(data) } }],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata?.totalTokenCount || 0
    }
  });
}

function toGeminiContents(messages) {
  return messages.map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }]
  }));
}

function extractGeminiText(response) {
  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string" && part.text) return part.text;
    }
  }
  throw new Error("Gemini returned no text output.");
}

function readBody(request, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(Object.assign(new Error("Request too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function loadEnvFile() {
  try {
    const text = await readFile(join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
