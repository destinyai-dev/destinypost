import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, Logger } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { readRequestContext } from '@gitroom/nestjs-libraries/chat/tools/tool.context.helper';
import { generateCarouselInputSchema } from '@gitroom/nestjs-libraries/chat/tools/generate.carousel.schema';
import {
  CAROUSEL_HEIGHT,
  CAROUSEL_WIDTH,
  renderCarouselSlide,
} from '@gitroom/nestjs-libraries/chat/tools/carousel.renderer';

@Injectable()
export class GenerateCarouselTool implements AgentToolInterface {
  private readonly logger = new Logger(GenerateCarouselTool.name);
  private readonly storage = UploadFactory.createStorage();

  constructor(private readonly mediaService: MediaService) {}

  name = 'generateCarouselTool';

  run() {
    return createTool({
      id: 'generateCarouselTool',
      description: `Render a complete, consistent Instagram carousel without consuming image-generation credits.

Use this tool only after the user explicitly asks for a carousel and approves the final slide outline.

This tool creates every slide as a deterministic 1080x1350 (4:5) PNG. Text is rendered by the application, so spelling, typography, palette and layout remain consistent across the full carousel.

Template selection:
- authority: bold, high-contrast positioning, strong hooks and premium offers.
- editorial: refined, spacious storytelling, personal brands and thought leadership.
- educational: step-by-step lessons, checklists, tutorials and practical tips.
- case-study: audits, before/after, proof, diagnoses and breakdowns.

Quality rules:
- Use 3 to 10 slides. Default to 6 when the user did not specify.
- Slide 1 is the cover and needs one clear promise or tension.
- One idea per slide. Headlines should normally have at most 12 words.
- Keep body copy concise. Prefer 220 characters or less per slide.
- The final slide must contain one direct CTA.
- Reuse the latest approved Instagram brand DNA from this thread: palette, positioning, audience, communication style and selected content idea.
- Do not invent a new palette when the DNA already provides one.
- After this tool returns, show every returned file as a Markdown image in slide order.`,
      inputSchema: generateCarouselInputSchema,
      outputSchema: z.object({
        template: z.string(),
        width: z.number(),
        height: z.number(),
        files: z.array(
          z.object({
            id: z.string(),
            path: z.string(),
            index: z.number(),
            headline: z.string(),
          })
        ),
      }),
      execute: async (input: any, options: any) => {
        checkAuth(input, options);
        const requestContext = readRequestContext(options);
        const org = JSON.parse(requestContext.get('organization') as string);
        const profileId = requestContext.get('profileId') as string | undefined;
        const footer =
          input.footer ||
          (input.username
            ? `@${String(input.username).replace(/^@/, '')}`
            : input.brandName);
        const files: Array<{
          id: string;
          path: string;
          index: number;
          headline: string;
        }> = [];
        const startedAt = Date.now();

        for (let index = 0; index < input.slides.length; index += 1) {
          const slide = input.slides[index];
          const png = await renderCarouselSlide({
            slide,
            index,
            total: input.slides.length,
            template: input.template,
            palette: input.palette,
            brandName: input.brandName,
            footer,
          });
          const uploaded = await this.storage.uploadSimple(
            `data:image/png;base64,${png.toString('base64')}`
          );
          const saved = await this.mediaService.saveFile(
            org.id,
            uploaded.split('/').pop(),
            uploaded,
            undefined,
            profileId
          );
          files.push({
            id: saved.id,
            path: saved.path,
            index: index + 1,
            headline: slide.headline,
          });
        }

        this.logger.log(
          `carousel complete template=${input.template} slides=${
            files.length
          } durationMs=${Date.now() - startedAt} profile=${profileId ?? '-'}`
        );

        return {
          template: input.template,
          width: CAROUSEL_WIDTH,
          height: CAROUSEL_HEIGHT,
          files,
        };
      },
    });
  }
}
