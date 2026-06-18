/**
 * POST /imports — upload a Gantt image and extract OEM events via Gemini.
 *
 * Flow:
 *   1. Receive multipart image upload, save to uploads/ volume.
 *   2. Call Gemini API for structured extraction.
 *   3. Return extracted events + sourceImageId for the review screen.
 *   4. Client confirms/edits → POST /imports/:id/confirm saves to DB.
 */

import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { prisma } from "../db.js";
import { extractEventsFromImage, inferMimeType } from "../extraction/gemini.js";

// Base directory for uploaded images (mapped to a persistent volume in Docker)
const UPLOADS_DIR = process.env["UPLOADS_DIR"] ?? path.join(process.cwd(), "uploads");

export async function importRoutes(app: FastifyInstance) {
  // POST /imports — upload image and trigger Gemini extraction
  app.post("/", async (req, reply) => {
    // req.parts() iterates all multipart fields and files in stream order.
    // req.body is NOT populated for multipart when attachFieldsToBody is off.
    let fileBuffer: Buffer | undefined;
    let originalFilename = "upload.jpg";
    let projectId: string | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        originalFilename = part.filename || "upload.jpg";
      } else if (part.type === "field" && part.fieldname === "projectId") {
        projectId = String(part.value);
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ ok: false, error: "No file uploaded" });
    }
    if (!projectId) {
      return reply.status(400).send({ ok: false, error: "projectId is required" });
    }

    // Save file to uploads directory
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const ext = path.extname(originalFilename) || ".jpg";
    const storedFilename = `${crypto.randomUUID()}${ext}`;
    const storagePath = path.join(UPLOADS_DIR, storedFilename);
    await fs.writeFile(storagePath, fileBuffer);

    // Save source image record
    const sourceImage = await prisma.sourceImage.create({
      data: {
        projectId,
        filename: originalFilename,
        storagePath: storedFilename,
      },
    });

    // Call Gemini extraction
    let events;
    try {
      events = await extractEventsFromImage({
        imagePath: storagePath,
        mimeType: inferMimeType(originalFilename),
      });
    } catch (err) {
      app.log.error({ err }, "Gemini extraction failed");
      return reply.status(502).send({
        ok: false,
        error: "Image extraction failed. Check GEMINI_API_KEY and network access.",
        details: err instanceof Error ? err.message : String(err),
      });
    }

    // Update extraction timestamp
    await prisma.sourceImage.update({
      where: { id: sourceImage.id },
      data: { extractedAt: new Date() },
    });

    return {
      ok: true,
      data: {
        sourceImageId: sourceImage.id,
        events,
        extractedAt: new Date().toISOString(),
      },
    };
  });

  // POST /imports/:sourceImageId/confirm — save confirmed events to DB
  app.post<{
    Params: { sourceImageId: string };
    Body: {
      projectId: string;
      events: Array<{
        name: string;
        type: string;
        startDate: string;
        endDate: string;
        isMilestone: boolean;
        confidence?: number;
      }>;
    };
  }>("/:sourceImageId/confirm", async (req, reply) => {
    const { sourceImageId } = req.params;
    const { projectId, events } = req.body;

    if (!events?.length) {
      return reply.status(400).send({ ok: false, error: "events array is empty" });
    }

    const created = await prisma.$transaction(
      events.map((ev) =>
        prisma.oemEvent.create({
          data: {
            projectId,
            name: ev.name,
            type: ev.type as "event" | "test" | "delivery",
            startDate: new Date(ev.startDate),
            endDate: new Date(ev.endDate),
            isMilestone: ev.isMilestone,
            sourceImageId,
            extractionConfidence: ev.confidence ?? null,
          },
        })
      )
    );

    return reply.status(201).send({ ok: true, data: { created: created.length } });
  });
}
