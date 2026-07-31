import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { decryptIntegrationToken } from '@gitroom/nestjs-libraries/crypto/integration-token.helper';
import {
  AiTextService,
  InstagramBrandDna,
  InstagramContentIdea,
} from '@gitroom/nestjs-libraries/ai/ai-text.service';
import { AiWebSearchService } from '@gitroom/nestjs-libraries/ai/ai-web-search.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

const META_GRAPH_VERSION = 'v25.0';
const MAX_MEDIA_ITEMS = 12;
const MAX_EXTERNAL_CONTEXT = 14_000;

export interface InstagramReferenceMedia {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: string;
}

export interface InstagramPublicProfile {
  id?: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  followsCount?: number;
  mediaCount?: number;
  media: InstagramReferenceMedia[];
}

export interface InstagramStrategyResult {
  username: string;
  profile: InstagramPublicProfile;
  brandDna: InstagramBrandDna;
  ideas: InstagramContentIdea[];
  sources: Array<{ title: string; url: string }>;
  sourceType: 'meta' | 'web' | 'mixed';
  caveats: string[];
}

type GraphProfileResponse = {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  media?: {
    data?: Array<{
      id?: string;
      caption?: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
    }>;
  };
  business_discovery?: GraphProfileResponse;
  error?: { message?: string; code?: number };
};

@Injectable()
export class InstagramStrategyService {
  private readonly logger = new Logger(InstagramStrategyService.name);

  constructor(
    private readonly integrationService: IntegrationService,
    private readonly encryption: EncryptionService,
    private readonly aiTextService: AiTextService,
    private readonly webSearchService: AiWebSearchService
  ) {}

  async analyze(
    organizationId: string,
    profileId: string | undefined,
    rawUsername: string,
    integrationId?: string
  ): Promise<InstagramStrategyResult> {
    const username = this.normalizeUsername(rawUsername);
    const integration = await this.resolveInstagramIntegration(
      organizationId,
      profileId,
      integrationId
    );

    let graphProfile: InstagramPublicProfile | undefined;
    const caveats: string[] = [];
    if (integration) {
      try {
        graphProfile = await this.fetchProfileFromMeta(integration, username);
      } catch (error) {
        this.logger.warn(
          `Meta profile lookup failed for @${username}: ${this.safeError(
            error
          )}`
        );
        caveats.push(
          'A Meta nao disponibilizou todos os dados deste perfil; complementamos a analise com fontes publicas.'
        );
      }
    } else {
      caveats.push(
        'Nenhum canal Instagram profissional foi encontrado. A analise usa apenas fontes publicas e pode ter menor precisao.'
      );
    }

    const webEvidence = await this.collectWebEvidence(
      organizationId,
      profileId,
      username,
      graphProfile?.website
    );

    if (!graphProfile && webEvidence.context.length < 80) {
      throw new HttpException(
        `Nao foi possivel encontrar informacoes publicas suficientes sobre @${username}. Verifique o arroba ou conecte uma conta Instagram Business.`,
        404
      );
    }

    const profile =
      graphProfile ??
      ({
        username,
        media: [],
      } satisfies InstagramPublicProfile);

    const evidence = this.buildEvidence(profile, webEvidence.context);
    const brandDna = await this.aiTextService.generateInstagramBrandDna(
      organizationId,
      username,
      evidence,
      profileId
    );
    const ideas = await this.generateIdeas(
      organizationId,
      profileId,
      username,
      brandDna,
      [],
      6
    );

    const sources = this.uniqueSources([
      {
        title: `Instagram @${username}`,
        url: `https://www.instagram.com/${encodeURIComponent(username)}/`,
      },
      ...(profile.website
        ? [{ title: 'Link da bio', url: profile.website }]
        : []),
      ...webEvidence.sources,
    ]);

    if (!graphProfile) {
      caveats.push(
        'Perfis pessoais, privados ou sem acesso profissional podem ter campos incompletos na API oficial.'
      );
    }

    return {
      username,
      profile,
      brandDna,
      ideas,
      sources,
      sourceType: graphProfile
        ? webEvidence.context
          ? 'mixed'
          : 'meta'
        : 'web',
      caveats,
    };
  }

  async generateIdeas(
    organizationId: string,
    profileId: string | undefined,
    username: string,
    brandDna: InstagramBrandDna,
    previousTitles: string[] = [],
    count = 6
  ): Promise<InstagramContentIdea[]> {
    const safeCount = Math.min(Math.max(Number(count) || 6, 3), 8);
    const generated = await this.aiTextService.generateInstagramContentIdeas(
      organizationId,
      this.normalizeUsername(username),
      brandDna,
      previousTitles.slice(-50),
      safeCount,
      profileId
    );

    return generated.map((idea) => ({
      ...idea,
      id: idea.id || makeId(12),
    }));
  }

  private async resolveInstagramIntegration(
    organizationId: string,
    profileId?: string,
    requestedId?: string
  ): Promise<Integration | undefined> {
    const integrations = (await this.integrationService.getIntegrationsList(
      organizationId,
      profileId
    )) as Integration[];
    const available = integrations.filter(
      (item) =>
        !item.disabled &&
        !item.deletedAt &&
        ['instagram', 'instagram-standalone'].includes(item.providerIdentifier)
    );

    const selected = requestedId
      ? available.find((item) => item.id === requestedId)
      : available.find((item) => item.providerIdentifier === 'instagram') ??
        available[0];

    if (!selected) return undefined;
    return (
      (await this.integrationService.getIntegrationById(
        organizationId,
        selected.id
      )) ?? undefined
    );
  }

  private async fetchProfileFromMeta(
    integration: Integration,
    username: string
  ): Promise<InstagramPublicProfile> {
    const token = decryptIntegrationToken(this.encryption, integration.token);
    if (!token) {
      throw new Error('Instagram access token is empty');
    }

    const direct = await this.fetchDirectProfile(integration, token);
    if (
      direct?.username &&
      this.normalizeUsername(direct.username) === username
    ) {
      return this.mapGraphProfile(direct, username);
    }

    if (integration.providerIdentifier !== 'instagram') {
      throw new Error(
        'Instagram Login direto so permite analisar a propria conta pela API'
      );
    }

    const fields = `business_discovery.username(${username}){${this.graphFields()}}`;
    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${integration.internalId}`
    );
    url.searchParams.set('fields', fields);
    url.searchParams.set('access_token', token);
    const body = await this.fetchGraph(url);
    if (!body.business_discovery) {
      throw new Error('Business Discovery returned no profile');
    }
    return this.mapGraphProfile(body.business_discovery, username);
  }

  private async fetchDirectProfile(
    integration: Integration,
    token: string
  ): Promise<GraphProfileResponse | undefined> {
    try {
      const host =
        integration.providerIdentifier === 'instagram-standalone'
          ? 'graph.instagram.com'
          : 'graph.facebook.com';
      const url = new URL(
        `https://${host}/${META_GRAPH_VERSION}/${integration.internalId}`
      );
      url.searchParams.set('fields', this.graphFields());
      url.searchParams.set('access_token', token);
      return await this.fetchGraph(url);
    } catch {
      return undefined;
    }
  }

  private graphFields(): string {
    return [
      'id',
      'username',
      'name',
      'biography',
      'website',
      'profile_picture_url',
      'followers_count',
      'follows_count',
      'media_count',
      `media.limit(${MAX_MEDIA_ITEMS}){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}`,
    ].join(',');
  }

  private async fetchGraph(url: URL): Promise<GraphProfileResponse> {
    const response = await fetch(url.toString());
    const body = (await response.json()) as GraphProfileResponse;
    if (!response.ok || body.error) {
      throw new Error(
        body.error?.message || `Meta Graph returned HTTP ${response.status}`
      );
    }
    return body;
  }

  private mapGraphProfile(
    data: GraphProfileResponse,
    fallbackUsername: string
  ): InstagramPublicProfile {
    return {
      id: data.id,
      username: data.username || fallbackUsername,
      name: data.name,
      biography: data.biography,
      website: this.safePublicUrl(data.website),
      profilePictureUrl: data.profile_picture_url,
      followersCount: data.followers_count,
      followsCount: data.follows_count,
      mediaCount: data.media_count,
      media: (data.media?.data ?? [])
        .filter((item) => Boolean(item.id))
        .map((item) => ({
          id: item.id!,
          caption: (item.caption || '').slice(0, 1_500),
          mediaType: item.media_type || 'UNKNOWN',
          mediaUrl: item.media_url,
          thumbnailUrl: item.thumbnail_url,
          permalink: item.permalink,
          timestamp: item.timestamp,
        })),
    };
  }

  private async collectWebEvidence(
    organizationId: string,
    profileId: string | undefined,
    username: string,
    website?: string
  ): Promise<{
    context: string;
    sources: Array<{ title: string; url: string }>;
  }> {
    const contextParts: string[] = [];
    const sources: Array<{ title: string; url: string }> = [];

    if (website) {
      try {
        const extracted = await this.webSearchService.extract(
          organizationId,
          [website],
          profileId,
          {
            extractDepth: 'advanced',
            format: 'markdown',
            query:
              'marca, produtos, servicos, proposta de valor, publico e posicionamento',
          }
        );
        for (const result of (extracted as any).results ?? []) {
          const raw = String(result.rawContent ?? result.raw_content ?? '');
          if (raw) contextParts.push(`LINK DA BIO:\n${raw.slice(0, 8_000)}`);
          if (result.url) {
            sources.push({ title: 'Link da bio', url: result.url });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Bio link extraction failed for @${username}: ${this.safeError(
            error
          )}`
        );
      }
    }

    try {
      const search = await this.webSearchService.search(
        organizationId,
        `"@${username}" Instagram perfil bio nicho conteudo`,
        profileId,
        {
          maxResults: 6,
          searchDepth: 'advanced',
          includeAnswer: true,
        }
      );
      if ((search as any).answer) {
        contextParts.push(
          `RESUMO DA BUSCA:\n${String((search as any).answer).slice(0, 2_000)}`
        );
      }
      for (const result of search.results ?? []) {
        if (result.content) {
          contextParts.push(
            `FONTE ${result.title}:\n${String(result.content).slice(0, 2_000)}`
          );
        }
        if (result.url) {
          sources.push({
            title: result.title || result.url,
            url: result.url,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `Web search failed for @${username}: ${this.safeError(error)}`
      );
    }

    return {
      context: contextParts.join('\n\n').slice(0, MAX_EXTERNAL_CONTEXT),
      sources: this.uniqueSources(sources),
    };
  }

  private buildEvidence(
    profile: InstagramPublicProfile,
    webContext: string
  ): string {
    const profileContext = {
      username: profile.username,
      name: profile.name,
      biography: profile.biography,
      website: profile.website,
      followersCount: profile.followersCount,
      followsCount: profile.followsCount,
      mediaCount: profile.mediaCount,
      recentPosts: profile.media.map((item) => ({
        caption: item.caption,
        mediaType: item.mediaType,
        timestamp: item.timestamp,
      })),
    };
    return [
      'DADOS DA API META:',
      JSON.stringify(profileContext),
      webContext ? `DADOS PUBLICOS DA WEB:\n${webContext}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, MAX_EXTERNAL_CONTEXT);
  }

  private normalizeUsername(raw: string): string {
    const value = String(raw || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(value)) {
      throw new HttpException(
        'Informe um arroba valido do Instagram, sem espacos.',
        400
      );
    }
    return value;
  }

  private safePublicUrl(raw?: string): string | undefined {
    if (!raw) return undefined;
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol)
        ? url.toString()
        : undefined;
    } catch {
      return undefined;
    }
  }

  private uniqueSources(
    sources: Array<{ title: string; url: string }>
  ): Array<{ title: string; url: string }> {
    const seen = new Set<string>();
    return sources.filter((source) => {
      const url = this.safePublicUrl(source.url);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      source.url = url;
      return true;
    });
  }

  private safeError(error: unknown): string {
    return String((error as Error)?.message || error)
      .replace(/access_token=[^&\s]+/gi, 'access_token=***')
      .replace(/Bearer\s+\S+/gi, 'Bearer ***')
      .slice(0, 300);
  }
}
