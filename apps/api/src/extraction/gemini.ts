/**
 * Gemini-based Gantt chart image extraction.
 *
 * Sends the uploaded image to the Gemini API and requests a JSON-structured
 * list of OEM events (name, type, dates, milestone flag, confidence).
 *
 * Security note:
 *  - Called ONLY during the "extract" operation initiated by the user.
 *  - The GEMINI_API_KEY must be set in environment; never committed to source.
 *  - Outbound traffic to generativelanguage.googleapis.com must be explicitly
 *    allowlisted in the firewall/proxy config of the closed network.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ExtractedEvent, OemEventType } from "@supplier-schedule/shared";

// ── Zod schema for Gemini response validation ──────────────────────────────

const ExtractedEventSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["event", "test", "delivery"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_milestone: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  events: z.array(ExtractedEventSchema),
});

// ── JSON Schema passed to Gemini (structured output mode) ─────────────────

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    events: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, description: "Event or milestone name" },
          type: {
            type: SchemaType.STRING,
            enum: ["event", "test", "delivery"],
            description: "Category of the event",
          },
          start_date: {
            type: SchemaType.STRING,
            description: "Start date in YYYY-MM-DD format",
          },
          end_date: {
            type: SchemaType.STRING,
            description: "End date in YYYY-MM-DD format (same as start_date for milestones)",
          },
          is_milestone: {
            type: SchemaType.BOOLEAN,
            description: "true if this is a point-in-time milestone (no duration)",
          },
          confidence: {
            type: SchemaType.NUMBER,
            description: "Extraction confidence 0.0–1.0 based on legibility",
          },
        },
        required: ["name", "type", "start_date", "end_date", "is_milestone", "confidence"],
      },
    },
  },
  required: ["events"],
};

// ── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Gantt chart analyzer for automotive OEM development schedules.
Extract all events, tests, and delivery milestones visible in the image.

Instructions:
- For each item, identify the name, type (event / test / delivery), start date, end date, and whether it is a milestone (a single point in time with no duration).
- Dates must be in YYYY-MM-DD format. If only the month/year is visible, use the first day of that month.
- For milestones, set end_date equal to start_date.
- Set confidence to a value 0.0–1.0 reflecting how clearly the item was readable.
- If a date is ambiguous or only partially visible, still include the event but set confidence < 0.5.
- Do NOT invent events that are not visible in the image.
- Focus on extracting OEM-side events (not supplier tasks).
- Return ALL events you can identify — the human reviewer will filter and correct.`;

// ── Main extraction function ───────────────────────────────────────────────

export interface ExtractionOptions {
  imagePath: string; // absolute path to the uploaded image file
  mimeType?: string; // defaults to "image/jpeg"
  apiKey?: string;   // defaults to process.env.GEMINI_API_KEY
  model?: string;    // defaults to "gemini-2.0-flash"
}

export async function extractEventsFromImage(
  options: ExtractionOptions
): Promise<ExtractedEvent[]> {
  const {
    imagePath,
    mimeType = "image/jpeg",
    apiKey = process.env["GEMINI_API_KEY"],
    model = "gemini-2.0-flash",
  } = options;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }

  const imageData = await fs.readFile(imagePath);
  const base64Image = imageData.toString("base64");

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const result = await geminiModel.generateContent([
    { text: SYSTEM_PROMPT },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
    {
      text: "Extract all OEM development events from this Gantt chart image. Return a JSON object with an 'events' array.",
    },
  ]);

  const responseText = result.response.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini returned non-JSON response: ${responseText.slice(0, 200)}`);
  }

  const validated = ExtractionResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Gemini response failed validation: ${validated.error.message}`
    );
  }

  return validated.data.events.map((e) => ({
    name: e.name,
    type: e.type as OemEventType,
    startDate: e.start_date,
    endDate: e.end_date,
    isMilestone: e.is_milestone,
    confidence: e.confidence,
  }));
}

// ── MIME type helper ───────────────────────────────────────────────────────

export function inferMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return map[ext] ?? "image/jpeg";
}
