import { z } from 'zod';

/**
 * Prompt Library wire contract (GET /api/user/ai-prompts).
 *
 * Named, reusable custom AI prompts, managed from the mobile/desktop apps.
 * The plugin is a read-only consumer: it loads presets into the AI comment
 * banner's custom prompt input.
 */

const SavedPromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  isDefault: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PromptLibraryEnvelopeSchema = z.object({
  success: z.literal(true),
  prompts: z.array(SavedPromptSchema),
}).passthrough();

export type SavedPrompt = Readonly<z.infer<typeof SavedPromptSchema>>;

export function parsePromptLibraryResponse(value: unknown): readonly SavedPrompt[] | null {
  const parsed = PromptLibraryEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data.prompts : null;
}
