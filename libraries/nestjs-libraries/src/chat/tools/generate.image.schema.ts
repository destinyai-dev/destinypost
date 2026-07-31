import { z } from 'zod';

const normalizeOptionalUrl = (value: unknown): string | undefined => {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as { url?: unknown }).url
      : value;

  if (typeof candidate !== 'string') {
    return undefined;
  }

  const normalized = candidate.trim();
  if (
    !normalized ||
    ['none', 'null', 'undefined', 'n/a'].includes(normalized.toLowerCase())
  ) {
    return undefined;
  }

  return normalized;
};

const normalizeOptionalStyle = (value: unknown): string | undefined => {
  const candidate =
    typeof value === 'object' && value !== null
      ? (value as { style?: unknown; name?: unknown }).style ??
        (value as { name?: unknown }).name
      : value;

  if (typeof candidate !== 'string' || !candidate.trim()) {
    return undefined;
  }

  return candidate.trim();
};

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { value?: unknown }).value === 'boolean'
  ) {
    return (value as { value: boolean }).value;
  }

  return undefined;
};

export const generateImageInputSchema = z.object({
  prompt: z
    .string()
    .describe(
      'Visual description (text-to-image) OR transformation hint (image-to-image).'
    ),
  mode: z
    .enum(['T2I', 'I2I'])
    .describe(
      "'T2I' = text-to-image (no reference image). 'I2I' = image-to-image (transform a reference). Use 'I2I' when the user provides an image URL or asks to edit/restyle/transform an existing image."
    ),
  referenceImageUrl: z
    .preprocess(normalizeOptionalUrl, z.string().url().optional())
    .describe(
      'Required when mode=I2I. Public http(s) URL of the reference image. Omit when mode=T2I.'
    ),
  aspectRatio: z
    .enum(['1:1', '9:16', '16:9'])
    .describe(
      'Target aspect ratio. 1:1 = Instagram feed, 9:16 = Stories/Reels/TikTok, 16:9 = YouTube/LinkedIn.'
    ),
  style: z
    .preprocess(normalizeOptionalStyle, z.string().max(160).optional())
    .describe(
      'Optional style hint (e.g. "Realistic", "Cartoon", "Cyberpunk"). Omit when no style was requested.'
    ),
  manualPrompt: z
    .preprocess(normalizeOptionalBoolean, z.boolean().optional())
    .describe(
      'When true, the prompt goes raw to the image model (no LLM enrichment). Default false. Set true only if the user provided a fully crafted prompt and asked to use it as-is.'
    ),
});
