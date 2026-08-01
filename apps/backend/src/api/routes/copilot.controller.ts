import {
  Logger,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Param,
  Body,
  HttpException,
} from '@nestjs/common';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { Organization, Profile } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { AiClientFactory } from '@gitroom/nestjs-libraries/ai/ai-client.factory';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { InstagramStrategyService } from '@gitroom/nestjs-libraries/ai/instagram-strategy.service';
import { InstagramBrandDna } from '@gitroom/nestjs-libraries/ai/ai-text.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { loadFromUrlOrDataUrl } from '@gitroom/nestjs-libraries/upload/storage.helpers';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
  profileId?: string;
  persona?: string;
};

@Controller('/copilot')
export class CopilotController {
  private readonly _logger = new Logger(CopilotController.name);

  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _profileService: ProfileService,
    private _aiClientFactory: AiClientFactory,
    private _instagramStrategyService: InstagramStrategyService,
    private _mediaService: MediaService
  ) {}

  /**
   * Constroi o serviceAdapter do CopilotKit a partir da credencial de TEXTO
   * configurada na UI (Configuracoes > Modelos de IA), seja OpenAI ou
   * OpenRouter. Substitui a antiga dependencia da env var `OPENAI_API_KEY`.
   *
   * A construcao do cliente `openai` (SDK) e o manuseio da apiKey ficam na
   * library (`AiClientFactory.buildOpenAiCompatibleClient`); aqui so envolvemos
   * o cliente pronto no `OpenAIAdapter`. O `as any` cobre o gap de tipos entre
   * o `openai` v6 do monorepo e o v4 contra o qual o adapter foi tipado.
   */
  private async buildServiceAdapter(
    organizationId: string,
    profileId?: string
  ): Promise<OpenAIAdapter> {
    const { client, model } =
      await this._aiClientFactory.buildOpenAiCompatibleClient(
        organizationId,
        profileId
      );
    return new OpenAIAdapter({ openai: client as any, model });
  }

  /**
   * Responde a request com o erro de resolucao de credencial em vez de deixar
   * a request pendurada (o que antes gerava 504 no nginx). Credencial nao
   * configurada/compartilhada chega como HttpException 412 de
   * `AiProviderResolverService`.
   */
  private respondCredentialError(res: Response, err: unknown) {
    const status = err instanceof HttpException ? err.getStatus() : 500;
    const message =
      err instanceof HttpException
        ? err.getResponse()
        : 'Erro ao resolver credencial de IA';
    Logger.warn(
      `Copilot: falha ao resolver credencial de IA (status ${status})`
    );
    return res.status(status).json({ message });
  }

  private normalizeVisionPath(path: string): string {
    if (!path) {
      throw new HttpException('Imagem invalida.', 400);
    }

    if (path.startsWith('data:')) {
      return path;
    }

    if (/^https:\/\//i.test(path)) {
      return path;
    }

    if (path.startsWith('/')) {
      const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
      if (!base) {
        throw new HttpException(
          'FRONTEND_URL nao configurada para analisar imagens locais.',
          500
        );
      }
      return `${base}${path}`;
    }

    throw new HttpException('A imagem precisa ser uma URL HTTPS publica.', 400);
  }

  private async resolveVisionImage(
    organizationId: string,
    profileId: string | undefined,
    input: { id?: string; path?: string }
  ): Promise<{ path: string; label: string }> {
    if (input?.id) {
      const media = await this._mediaService.getMediaById(input.id);
      if (
        !media ||
        (media as any).organizationId !== organizationId ||
        (media as any).deletedAt
      ) {
        throw new HttpException('Imagem nao encontrada.', 404);
      }

      if (
        profileId &&
        (media as any).profileId &&
        (media as any).profileId !== profileId
      ) {
        throw new HttpException('Imagem nao pertence a este perfil.', 403);
      }

      return {
        path: this.normalizeVisionPath((media as any).path),
        label: (media as any).originalName || (media as any).name || input.id,
      };
    }

    return {
      path: this.normalizeVisionPath(input?.path || ''),
      label: input?.path || 'imagem',
    };
  }

  private async loadVisionImageData(path: string): Promise<{
    contentType: string;
    base64: string;
  }> {
    const image =
      (await this.loadLocalUploadImageData(path)) ||
      (await loadFromUrlOrDataUrl(path));
    if (!image.contentType.toLowerCase().startsWith('image/')) {
      throw new HttpException('O arquivo anexado nao e uma imagem.', 400);
    }

    // Evita mandar anexos enormes para o provedor de IA e estourar timeout.
    if (image.buffer.byteLength > 8 * 1024 * 1024) {
      throw new HttpException(
        'A imagem e muito grande para analise. Use uma imagem de ate 8 MB.',
        400
      );
    }

    return {
      contentType: image.contentType,
      base64: image.buffer.toString('base64'),
    };
  }

  private contentTypeFromExtension(path: string) {
    const ext = extname(path).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    return map[ext] || 'application/octet-stream';
  }

  private getLocalUploadRelativePath(path: string): string | undefined {
    const frontendUrl = process.env.FRONTEND_URL;
    try {
      if (/^https:\/\//i.test(path) && frontendUrl) {
        const imageUrl = new URL(path);
        const appUrl = new URL(frontendUrl);
        if (
          imageUrl.origin === appUrl.origin &&
          imageUrl.pathname.startsWith('/uploads/')
        ) {
          return decodeURIComponent(imageUrl.pathname.replace('/uploads/', ''));
        }
      }

      if (path.startsWith('/uploads/')) {
        return decodeURIComponent(path.replace('/uploads/', ''));
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private async loadLocalUploadImageData(path: string): Promise<{
    buffer: Buffer;
    contentType: string;
    extension: string;
  } | null> {
    const uploadDirectory = process.env.UPLOAD_DIRECTORY;
    if (!uploadDirectory) {
      return null;
    }

    const relativePath = this.getLocalUploadRelativePath(path);
    if (!relativePath) {
      return null;
    }

    const root = resolve(uploadDirectory);
    const filePath = resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      throw new HttpException('Caminho de imagem invalido.', 400);
    }

    try {
      const buffer = await readFile(filePath);
      const contentType = this.contentTypeFromExtension(filePath);
      return {
        buffer,
        contentType,
        extension: contentType.split('/')[1]?.split('+')[0] || 'bin',
      };
    } catch (err) {
      this._logger.warn(
        `Nao foi possivel ler upload local para OCR (${filePath}): ${
          (err as Error).message
        }`
      );
      return null;
    }
  }

  private parseVisionAnalysis(raw: string): {
    analysis: string;
    transcription: string;
  } {
    const analysis = (raw || '').trim();
    const refused =
      /NAO_CONSEGUI_LER_A_IMAGEM/i.test(analysis) ||
      /n[aã]o (?:consigo|posso) (?:ler|visualizar|acessar)/i.test(analysis) ||
      /(?:imagem|url).{0,40}n[aã]o (?:carregou|carrega|est[aá] acess[ií]vel)/i.test(
        analysis
      );

    if (!analysis || refused) {
      throw new HttpException(
        'O modelo configurado nao conseguiu enxergar a imagem. Selecione um modelo multimodal com suporte real a visao.',
        412
      );
    }

    const transcriptionMatch = analysis.match(
      /TRANSCRI(?:CAO|ÇÃO)[_ ]LITERAL\s*:\s*([\s\S]*?)(?=\n\s*PARTES[_ ](?:ILEGIVEIS|ILEGÍVEIS)\s*:|\n\s*AN(?:A|Á)LISE[_ ]MARKETING\s*:|$)/i
    );
    const transcription = (transcriptionMatch?.[1] || '')
      .trim()
      .replace(/^[-*]\s*/gm, '')
      .trim();

    if (!transcription) {
      throw new HttpException(
        'A leitura visual voltou sem uma transcricao verificavel. Tente novamente com a imagem original em maior resolucao.',
        422
      );
    }

    return { analysis, transcription };
  }

  // Limite explicito de 30/min (o global e 30/h) — cada chamada de chat
  // consome a credencial de IA paga do workspace. Paridade com
  // ai-text.controller.ts.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('/chat')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async chatAgent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null
  ) {
    // Passa profile?.id para respeitar o gate shareDefault do resolver:
    // perfil secundario sem chave propria e sem compartilhamento -> 412
    // (mesma regra do /copilot/agent).
    let serviceAdapter: OpenAIAdapter;
    try {
      serviceAdapter = await this.buildServiceAdapter(
        organization?.id,
        profile?.id
      );
    } catch (err) {
      return this.respondCredentialError(res, err);
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      runtime: new CopilotRuntime(),
      serviceAdapter,
    });

    return copilotRuntimeHandler(req, res);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null
  ) {
    // Resolve a credencial da UI (OpenAI/OpenRouter) ANTES de montar o runtime.
    // Falha de credencial responde 412 aqui em vez de deixar a request pendurar
    // (o que antes gerava 504 no nginx). O adapter em si nao faz a inferencia do
    // agente (o Mastra faz), mas o CopilotRuntime exige um serviceAdapter valido.
    let serviceAdapter: OpenAIAdapter;
    try {
      serviceAdapter = await this.buildServiceAdapter(
        organization.id,
        profile?.id
      );
    } catch (err) {
      return this.respondCredentialError(res, err);
    }

    const mastra = await this._mastraService.mastra();
    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.variables?.properties?.integrations || []
    );

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');

    // Per-profile credenciais e persona — sem isso o agente usa apenas
    // o default workspace e ignora a persona configurada em
    // Settings > Persona de IA, fazendo o tom de voz, restricoes e CTAs
    // sumirem mesmo quando o usuario preencheu tudo.
    if (profile?.id) {
      requestContext.set('profileId', profile.id);
      try {
        const persona = await this._profileService.getPersonaForAgent(
          profile.id
        );
        if (persona) {
          requestContext.set('persona', JSON.stringify(persona));
        }
      } catch (err) {
        // Best-effort: persona quebrada nao deve bloquear o chat.
        Logger.warn(
          `Falha ao carregar persona do profile ${profile.id}: ${
            (err as Error).message
          }`
        );
      }
    }

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as any,
    });

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: '/copilot/agent',
      runtime,
      // properties: req.body.variables.properties,
      serviceAdapter,
    });

    return copilotRuntimeHandler.handleRequest(req, res);
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type') type: 'ai_images' | 'ai_videos'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('/instagram/analyze')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  analyzeInstagramProfile(
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body()
    body: {
      username: string;
      integrationId?: string;
    }
  ) {
    return this._instagramStrategyService.analyze(
      organization.id,
      profile?.id,
      body?.username,
      body?.integrationId
    );
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('/vision/analyze')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async analyzeAttachedImages(
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body()
    body: {
      prompt?: string;
      images?: Array<{
        id?: string;
        path?: string;
      }>;
    }
  ): Promise<{ analysis: string; transcription: string }> {
    const images = Array.isArray(body?.images)
      ? body.images.filter((image) => image?.id || image?.path).slice(0, 4)
      : [];

    if (!images.length) {
      throw new HttpException('Envie pelo menos uma imagem para analisar.', 400);
    }

    const { client, model } =
      await this._aiClientFactory.buildOpenAiCompatibleClient(
        organization.id,
        profile?.id
      );

    try {
      const loadedImages = await Promise.all(
        images.map(async (image, index) => {
          const resolved = await this.resolveVisionImage(
            organization.id,
            profile?.id,
            image
          );
          const data = await this.loadVisionImageData(resolved.path);
          return {
            label: resolved.label,
            index: index + 1,
            ...data,
          };
        })
      );

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Voce e um mecanismo rigoroso de OCR e analise visual para marketing. Sua prioridade absoluta e transcrever literalmente o texto visivel nas imagens. E proibido inventar texto, inferir pelo contexto, usar historico da conversa, usar nome de dominio, usar nome do arquivo ou trocar a oferta por uma ideia parecida. Se nao conseguir ler a imagem com seguranca, escreva exatamente: NAO_CONSEGUI_LER_A_IMAGEM. Se uma palavra estiver pequena ou borrada, marque como "[ilegivel]" ou "[aproximado]". Depois da transcricao literal, analise criativo, nicho, oferta, promessa, estilo visual, publico-alvo e oportunidades de copy. Responda sempre em portugues do Brasil.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Pedido do usuario: ${
                  body?.prompt?.trim() ||
                  'Analise as imagens e descreva o que aparece nelas para criar copy de marketing.'
                }\n\nIMPORTANTE: Leia somente a imagem anexada. Nao use memoria, contexto antigo, exemplos, nichos provaveis ou conhecimento externo para preencher o texto.\n\nPara cada imagem, mantenha a ordem e responda nesta estrutura:\nTRANSCRICAO_LITERAL:\n- linha por linha do texto visivel, sem reescrever com outras palavras\nPARTES_ILEGIVEIS:\n- liste partes pequenas, borradas ou incertas; se nao houver, escreva "nenhuma"\nANALISE_MARKETING:\n- produto/tema, estilo, emocao, publico provavel, angulo de venda e sugestoes de copy\n\nSe o pedido do usuario for apenas "o que esta escrito", responda principalmente com TRANSCRICAO_LITERAL. Se voce nao conseguir ler a imagem, responda NAO_CONSEGUI_LER_A_IMAGEM e nao invente nenhum texto.`,
              },
              ...loadedImages.map((image) => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${image.contentType};base64,${image.base64}`,
                  detail: 'high' as const,
                },
              })),
            ],
          },
        ],
        temperature: 0,
      });

      const analysis =
        response?.choices?.[0]?.message?.content?.trim?.() || '';
      const parsed = this.parseVisionAnalysis(analysis);

      this._logger.log(
        `OCR visual concluido (model=${model}, images=${loadedImages.length}, bytes=${loadedImages.reduce(
          (total, image) => total + Buffer.byteLength(image.base64, 'base64'),
          0
        )}, transcriptionChars=${parsed.transcription.length})`
      );

      return parsed;
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : undefined;
      if (status) {
        throw err;
      }

      this._logger.warn(
        `Falha ao analisar imagem no agente: ${(err as Error).message}`
      );

      throw new HttpException(
        'O modelo de texto configurado nao conseguiu analisar a imagem. Configure um modelo com visao, como GPT-4o/GPT-5, Gemini com visao ou outro modelo OpenAI-compativel multimodal.',
        412
      );
    }
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('/instagram/ideas')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  generateInstagramIdeas(
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body()
    body: {
      username: string;
      brandDna: InstagramBrandDna;
      previousTitles?: string[];
      count?: number;
    }
  ) {
    if (!body?.brandDna || typeof body.brandDna !== 'object') {
      throw new HttpException('DNA da marca obrigatorio', 400);
    }
    return this._instagramStrategyService.generateIdeas(
      organization.id,
      profile?.id,
      body.username,
      body.brandDna,
      Array.isArray(body.previousTitles) ? body.previousTitles : [],
      body.count ?? 6
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<{ uiMessages: Array<{ role: string; content: string }> }> {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    try {
      const recalled: any = await memory.recall({
        resourceId: organization.id,
        threadId,
      });
      // Mastra v1.21+ retorna { messages, total, ... }; versoes antigas
      // retornavam { uiMessages, messages, ... }. Normalizamos aqui pra
      // manter o contrato simples com o frontend (uiMessages = lista
      // sequencial de {role, content} pronta pra render).
      const rawMessages: any[] = Array.isArray(recalled?.uiMessages)
        ? recalled.uiMessages
        : Array.isArray(recalled?.messages)
        ? recalled.messages
        : [];
      return {
        uiMessages: rawMessages
          .map((m) => normalizeMessageForUi(m))
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => m.content && m.content.trim().length > 0),
      };
    } catch (err) {
      Logger.warn(
        `Falha ao carregar mensagens do thread ${threadId}: ${
          (err as Error).message
        }`
      );
      return { uiMessages: [] };
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}

/**
 * Mensagens vindas de `memory.recall()` do Mastra podem ter `content`
 * em varios formatos:
 *  - string simples (V1)
 *  - array de parts: `[{ type: 'text', text: '...' }, { type: 'tool-call', ... }]`
 *  - objeto com `parts` aninhado
 *
 * Aqui extraimos somente o texto agregado, descartando partes nao-texto
 * (tool-calls, imagens). O frontend usa `TextMessage({ content, role })`,
 * entao nao precisamos preservar a estrutura de parts.
 */
function normalizeMessageForUi(m: any): { role: string; content: string } {
  const role = String(m?.role ?? '');
  const raw = m?.content;

  if (typeof raw === 'string') {
    return { role, content: raw };
  }

  if (Array.isArray(raw)) {
    const text = raw
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return { role, content: text };
  }

  if (raw && typeof raw === 'object' && Array.isArray(raw.parts)) {
    const text = raw.parts
      .map((part: any) =>
        part?.type === 'text' && typeof part.text === 'string' ? part.text : ''
      )
      .filter(Boolean)
      .join('\n');
    return { role, content: text };
  }

  return { role, content: '' };
}
