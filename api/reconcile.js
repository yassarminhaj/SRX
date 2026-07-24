const model = "gemini-3.6-flash";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    response.status(503).json({
      error: "SRX Intelligence is not configured. Add the API key and redeploy."
    });
    return;
  }

  const payload = request.body;
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    response.status(400).json({ error: "A non-empty messages array is required." });
    return;
  }

  const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    response.status(geminiResponse.status).json({
      error: "SRX Intelligence could not complete the reconciliation request."
    });
    return;
  }

  const data = JSON.parse(raw);
  response.status(200).json({
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
