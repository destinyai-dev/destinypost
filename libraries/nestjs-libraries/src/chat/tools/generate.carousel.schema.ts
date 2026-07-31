import { z } from 'zod';

const optionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

export const CarouselTemplateSchema = z.enum([
  'authority',
  'editorial',
  'educational',
  'case-study',
]);

export type CarouselTemplate = z.infer<typeof CarouselTemplateSchema>;

export const CarouselSlideSchema = z.object({
  eyebrow: z.preprocess(optionalString, z.string().max(50).optional()),
  headline: z.string().trim().min(1).max(120),
  body: z.preprocess(optionalString, z.string().max(520).optional()),
});

export type CarouselSlide = z.infer<typeof CarouselSlideSchema>;

export const generateCarouselInputSchema = z.object({
  template: CarouselTemplateSchema.default('authority'),
  brandName: z.string().trim().min(1).max(80),
  username: z.preprocess(optionalString, z.string().max(30).optional()),
  palette: z.array(z.string().max(40)).min(2).max(6),
  slides: z.array(CarouselSlideSchema).min(3).max(10),
  footer: z.preprocess(optionalString, z.string().max(90).optional()),
});

export type GenerateCarouselInput = z.infer<typeof generateCarouselInputSchema>;
