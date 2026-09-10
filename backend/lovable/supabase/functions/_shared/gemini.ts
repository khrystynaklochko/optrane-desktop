import { env } from './env.ts';
import type { SceneBreakdown } from './domain.ts';
import { toBase64 } from './util.ts';
import { googleCloudAccessToken } from './gcp_auth.ts';

async function callGemini(contents: unknown[], responseSchema?: unknown) {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    temperature: 0.1,
    thinkingConfig: { thinkingLevel: 'MEDIUM' },
  };
  if (responseSchema) generationConfig.responseSchema = responseSchema;

  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (env.geminiProvider === 'vertex') {
    if (!env.googleCloudProject) throw new Error('GOOGLE_CLOUD_PROJECT is required for GEMINI_PROVIDER=vertex');
    const location = env.googleCloudLocation || 'global';
    const host = location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`;
    url = `${host}/v1/projects/${encodeURIComponent(env.googleCloudProject)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(env.geminiModel)}:generateContent`;
    headers.Authorization = `Bearer ${await googleCloudAccessToken()}`;
  } else {
    if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required for GEMINI_PROVIDER=gemini_api');
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`;
    headers['x-goog-api-key'] = env.geminiApiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contents, generationConfig }),
  });
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('Gemini returned no structured output');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 500)}`);
  }
}


const breakdownSchema = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene_number: { type: 'STRING' },
          heading: { type: 'STRING' },
          location: { type: 'STRING' },
          interior_exterior: { type: 'STRING' },
          day_night: { type: 'STRING' },
          page_eighths: { type: 'INTEGER' },
          description: { type: 'STRING' },
          elements: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                type: { type: 'STRING' },
                name: { type: 'STRING' },
                quantity: { type: 'INTEGER' },
                confidence: { type: 'STRING', enum: ['EXPLICIT', 'INFERRED', 'UNKNOWN'] },
              },
              required: ['type', 'name', 'quantity', 'confidence'],
            },
          },
        },
        required: ['scene_number', 'heading', 'location', 'interior_exterior', 'day_night', 'page_eighths', 'description', 'elements'],
      },
    },
  },
  required: ['scenes'],
};

export async function breakdownPdf(pdf: Uint8Array): Promise<SceneBreakdown[]> {
  const prompt = `You are OPTRANE's screenplay breakdown agent. Extract every numbered scene from the attached screenplay PDF into structured production data.

Rules:
- Return exactly one scene object per scene in screenplay order.
- Never invent hidden requirements as facts.
- Use confidence EXPLICIT for items stated in the screenplay, INFERRED only when a production implication is plausible but not stated, UNKNOWN when uncertain.
- element.type must be one of CAST, EXTRA, STUNT, MINOR, SECURITY, SPECIAL_EFFECT, PROP, VEHICLE, ANIMAL, WARDROBE, SPECIAL_EQUIPMENT, LOCATION, MAKEUP, SET_DRESSING.
- Keep legal/regulatory conclusions out of the breakdown; those become verification items later.
- page_eighths is an integer count of eighths for the scene; use 0 if the source does not support an estimate.
- Return JSON only.`;

  const result = await callGemini([{
    role: 'user',
    parts: [
      { text: prompt },
      { inlineData: { mimeType: 'application/pdf', data: toBase64(pdf) } },
    ],
  }], breakdownSchema) as { scenes?: SceneBreakdown[] };

  if (!Array.isArray(result.scenes) || result.scenes.length === 0) throw new Error('No scenes were extracted from screenplay');
  return result.scenes.map((scene) => ({
    scene_number: String(scene.scene_number ?? '').trim(),
    heading: String(scene.heading ?? '').trim(),
    location: String(scene.location ?? '').trim(),
    interior_exterior: String(scene.interior_exterior ?? 'UNKNOWN').toUpperCase(),
    day_night: String(scene.day_night ?? 'UNKNOWN').toUpperCase(),
    page_eighths: Number.isFinite(Number(scene.page_eighths)) ? Number(scene.page_eighths) : 0,
    description: String(scene.description ?? '').trim(),
    elements: Array.isArray(scene.elements) ? scene.elements.map((element) => ({
      type: String(element.type ?? 'UNKNOWN').toUpperCase(),
      name: String(element.name ?? '').trim(),
      quantity: Math.max(1, Number(element.quantity ?? 1)),
      confidence: ['EXPLICIT', 'INFERRED', 'UNKNOWN'].includes(String(element.confidence).toUpperCase())
        ? String(element.confidence).toUpperCase() as 'EXPLICIT' | 'INFERRED' | 'UNKNOWN'
        : 'UNKNOWN',
    })).filter((e) => e.name) : [],
  })).filter((scene) => scene.scene_number);
}

export async function explainRecommendation(input: {
  productionTitle: string;
  findings: Array<{ category: string; severity: string; reason: string }>;
  plans: Array<{ code: string; title: string; cost: number; minutes: number; risk: string; assumptions: string[] }>;
}) {
  if (env.geminiProvider === 'vertex' ? (!env.googleCloudProject || !env.googleServiceAccountJson) : !env.geminiApiKey) return null;
  const prompt = `You are OPTRANE's Recovery Agent. Given verified impact findings and three bounded executable plans, choose the strongest plan and explain why in concise producer language. Do not invent costs, legal conclusions, permissions, people, resources, or schedule facts. Return JSON only with recommended_code and reason.\n\n${JSON.stringify(input)}`;
  const schema = {
    type: 'OBJECT',
    properties: {
      recommended_code: { type: 'STRING', enum: ['A','B','C'] },
      reason: { type: 'STRING' },
    },
    required: ['recommended_code','reason'],
  };
  return await callGemini([{ role: 'user', parts: [{ text: prompt }] }], schema) as { recommended_code: 'A'|'B'|'C'; reason: string };
}
