import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  Post,
  Delete,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { Organization, Profile } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ImportMediaDto } from '@gitroom/nestjs-libraries/dtos/third-party/import-media.dto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { createHash, randomBytes } from 'crypto';
import { Response } from 'express';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';

const CANVA_API_URL = 'https://api.canva.com/rest/v1';
const CANVA_OAUTH_TTL_SECONDS = 10 * 60;
const CANVA_EXPORT_POLL_ATTEMPTS = 30;
const CANVA_EXPORT_POLL_INTERVAL_MS = 1_000;

type CanvaTokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  userId: string;
  teamId: string;
  displayName: string;
};

@ApiTags('Third Party')
@Controller('/third-party')
export class ThirdPartyController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _thirdPartyManager: ThirdPartyManager,
    private _mediaService: MediaService,
    private _credentialService: CredentialService
  ) {}

  private async getCanvaConfig(organizationId: string) {
    const stored = await this._credentialService.getRaw(
      organizationId,
      'canva'
    );
    const clientId =
      stored?.clientId?.trim() || process.env.CANVA_CLIENT_ID?.trim();
    const clientSecret =
      stored?.clientSecret?.trim() ||
      process.env.CANVA_CLIENT_SECRET?.trim();
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const redirectUri =
      process.env.CANVA_REDIRECT_URI?.trim() ||
      `${frontendUrl}/api/third-party/canva/oauth/callback`;
    const scopes = (
      process.env.CANVA_SCOPES ||
      'profile:read design:meta:read design:content:read'
    )
      .split(/[\s,]+/)
      .filter(Boolean)
      .join(' ');

    if (!clientId || !clientSecret || !frontendUrl) {
      throw new HttpException(
        'Canva integration is not configured on the server',
        503
      );
    }

    return { clientId, clientSecret, redirectUri, scopes };
  }

  private async readCanvaResponse(response: globalThis.Response) {
    const text = await response.text();
    let data: any = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      throw new HttpException(
        data?.message || data?.error_description || 'Canva request failed',
        response.status
      );
    }

    return data;
  }

  private async exchangeCanvaToken(
    organizationId: string,
    params: URLSearchParams
  ) {
    const { clientId, clientSecret } = await this.getCanvaConfig(
      organizationId
    );
    const response = await fetch(`${CANVA_API_URL}/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    return this.readCanvaResponse(response);
  }

  private async getCanvaIntegration(organizationId: string) {
    const saved =
      await this._thirdPartyManager.getAllThirdPartiesByOrganization(
        organizationId
      );
    const canva = saved.find((item) => item.identifier === 'canva');

    if (!canva) {
      throw new HttpException('Canva account is not connected', 404);
    }

    const integration = await this._thirdPartyManager.getIntegrationById(
      organizationId,
      canva.id
    );

    if (!integration) {
      throw new HttpException('Canva account is not connected', 404);
    }

    return integration;
  }

  private async getCanvaToken(organizationId: string) {
    const integration = await this.getCanvaIntegration(organizationId);
    let bundle: CanvaTokenBundle;

    try {
      bundle = JSON.parse(AuthService.fixedDecryption(integration.apiKey));
    } catch {
      throw new HttpException('Stored Canva credentials are invalid', 500);
    }

    if (bundle.expiresAt > Date.now() + 60_000) {
      return bundle.accessToken;
    }

    const token = await this.exchangeCanvaToken(
      organizationId,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: bundle.refreshToken,
      })
    );

    bundle = {
      ...bundle,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 14_400) * 1000,
      scope: token.scope || bundle.scope,
    };

    await this._thirdPartyManager.saveIntegration(
      organizationId,
      'canva',
      JSON.stringify(bundle),
      {
        id: bundle.userId,
        name: bundle.displayName,
        username: bundle.teamId,
      }
    );

    return bundle.accessToken;
  }

  private validateCanvaId(value: string, label: string) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
      throw new HttpException(`Invalid Canva ${label}`, 400);
    }
  }

  private async waitForCanvaExport(
    organizationId: string,
    exportId: string
  ): Promise<string[]> {
    this.validateCanvaId(exportId, 'export id');

    for (let attempt = 0; attempt < CANVA_EXPORT_POLL_ATTEMPTS; attempt += 1) {
      const result = await this.canvaRequest(
        organizationId,
        `/exports/${exportId}`
      );
      const job = result?.job;

      if (job?.status === 'success' && Array.isArray(job.urls)) {
        return job.urls.filter(
          (url: unknown): url is string =>
            typeof url === 'string' && url.startsWith('https://')
        );
      }

      if (job?.status === 'failed') {
        throw new HttpException(
          job?.error?.message || 'Canva could not export this design',
          422
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, CANVA_EXPORT_POLL_INTERVAL_MS)
      );
    }

    throw new HttpException('Canva export timed out', 504);
  }

  private async canvaRequest(
    organizationId: string,
    path: string,
    init: RequestInit = {}
  ) {
    const accessToken = await this.getCanvaToken(organizationId);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${CANVA_API_URL}${path}`, {
      ...init,
      headers,
    });

    return this.readCanvaResponse(response);
  }

  @Get('/list')
  async getThirdPartyList() {
    return this._thirdPartyManager.getAllThirdParties();
  }

  @Get('/canva/oauth/start')
  async startCanvaOAuth(
    @GetOrgFromRequest() organization: Organization,
    @Res({ passthrough: true }) response: Response,
    @Query('redirect') shouldRedirect?: string
  ) {
    const { clientId, redirectUri, scopes } = await this.getCanvaConfig(
      organization.id
    );
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    await ioRedis.set(
      `canva:oauth:${state}`,
      JSON.stringify({
        codeVerifier,
        organizationId: organization.id,
        createdAt: Date.now(),
      }),
      'EX',
      CANVA_OAUTH_TTL_SECONDS
    );

    const query = new URLSearchParams({
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: scopes,
      response_type: 'code',
      client_id: clientId,
      state,
      redirect_uri: redirectUri,
    });

    const authorizationUrl = `https://www.canva.com/api/oauth/authorize?${query.toString()}`;

    if (shouldRedirect === '1') {
      response.redirect(authorizationUrl);
      return;
    }

    return {
      authorizationUrl,
      redirectUri,
      scopes: scopes.split(' '),
    };
  }

  @Get('/canva/oauth/callback')
  async canvaOAuthCallback(
    @GetOrgFromRequest() organization: Organization,
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string
  ) {
    await this.exchangeCanvaAuthorization(organization, response, {
      code,
      state,
    });

    response.redirect('/third-party?canva=connected');
  }

  @Post('/canva/oauth/exchange')
  async exchangeCanvaAuthorization(
    @GetOrgFromRequest() organization: Organization,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { code?: string; state?: string }
  ) {
    if (!body.code || !body.state) {
      throw new ForbiddenException('Canva authorization session is missing');
    }

    const stateKey = `canva:oauth:${body.state}`;
    const storedState = await ioRedis.get(stateKey);

    if (!storedState) {
      throw new ForbiddenException('Canva authorization session has expired');
    }

    let oauthState: {
      codeVerifier: string;
      organizationId: string;
      createdAt: number;
    };

    try {
      oauthState = JSON.parse(storedState) as typeof oauthState;
    } catch {
      throw new ForbiddenException('Canva authorization session is invalid');
    }

    if (
      oauthState.organizationId !== organization.id ||
      Date.now() - oauthState.createdAt > CANVA_OAUTH_TTL_SECONDS * 1000
    ) {
      throw new ForbiddenException('Canva authorization session has expired');
    }

    await ioRedis.del(stateKey);

    const { redirectUri } = await this.getCanvaConfig(organization.id);
    const token = await this.exchangeCanvaToken(
      organization.id,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: body.code,
        code_verifier: oauthState.codeVerifier,
        redirect_uri: redirectUri,
      })
    );

    const headers = {
      Authorization: `Bearer ${token.access_token}`,
    };
    const [userResponse, profileResponse] = await Promise.all([
      fetch(`${CANVA_API_URL}/users/me`, { headers }),
      fetch(`${CANVA_API_URL}/users/me/profile`, { headers }),
    ]);
    const user = await this.readCanvaResponse(userResponse);
    const profile = await this.readCanvaResponse(profileResponse);
    const userId = user.team_user?.user_id;
    const teamId = user.team_user?.team_id;
    const displayName = profile.profile?.display_name || 'Canva';

    if (!userId || !teamId) {
      throw new HttpException('Canva user information is incomplete', 502);
    }

    const bundle: CanvaTokenBundle = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 14_400) * 1000,
      scope: token.scope || '',
      userId,
      teamId,
      displayName,
    };

    const saved = await this._thirdPartyManager.saveIntegration(
      organization.id,
      'canva',
      JSON.stringify(bundle),
      {
        id: userId,
        name: displayName,
        username: teamId,
      }
    );

    return {
      id: saved.id,
      name: displayName,
    };
  }

  @Get('/canva/designs')
  async getCanvaDesigns(
    @GetOrgFromRequest() organization: Organization,
    @Query('query') query?: string,
    @Query('continuation') continuation?: string
  ) {
    const params = new URLSearchParams({
      ownership: 'any',
      sort_by: 'modified_descending',
      limit: '24',
    });

    if (query) params.set('query', query);
    if (continuation) params.set('continuation', continuation);

    return this.canvaRequest(organization.id, `/designs?${params.toString()}`);
  }

  @Post('/canva/designs/:designId/import')
  async importCanvaDesign(
    @GetOrgFromRequest() organization: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('designId') designId: string
  ) {
    this.validateCanvaId(designId, 'design id');
    const exportResult = await this.canvaRequest(organization.id, '/exports', {
      method: 'POST',
      body: JSON.stringify({
        design_id: designId,
        format: {
          type: 'png',
          export_quality: 'regular',
          lossless: true,
          transparent_background: false,
          as_single_image: false,
        },
      }),
    });
    const exportId = exportResult?.job?.id;

    if (typeof exportId !== 'string') {
      throw new HttpException('Canva did not start the export', 502);
    }

    const urls = await this.waitForCanvaExport(organization.id, exportId);
    if (!urls.length) {
      throw new HttpException('Canva export returned no pages', 422);
    }
    if (urls.length > 50) {
      throw new HttpException(
        'Canva designs with more than 50 pages cannot be imported',
        422
      );
    }

    const media = [];
    for (let index = 0; index < urls.length; index += 1) {
      const filePath = await this.storage.uploadSimple(urls[index]);
      const fileName =
        filePath.split('/').pop() ||
        `canva-${designId}-${String(index + 1).padStart(2, '0')}.png`;
      media.push(
        await this._mediaService.saveFile(
          organization.id,
          fileName,
          filePath,
          `Canva ${designId} - pagina ${index + 1}`,
          profile?.id
        )
      );
    }

    return {
      designId,
      pageCount: media.length,
      media,
    };
  }

  @Delete('/canva')
  async disconnectCanva(@GetOrgFromRequest() organization: Organization) {
    const integration = await this.getCanvaIntegration(organization.id);

    try {
      const bundle = JSON.parse(
        AuthService.fixedDecryption(integration.apiKey)
      ) as CanvaTokenBundle;
      const { clientId, clientSecret } = await this.getCanvaConfig(
        organization.id
      );
      await fetch(`${CANVA_API_URL}/oauth/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: bundle.refreshToken,
        }),
      });
    } catch {
      // Removing the local credentials still disconnects an expired token.
    }

    await this._thirdPartyManager.deleteIntegration(
      organization.id,
      integration.id
    );
    return { success: true };
  }

  @Get('/')
  async getSavedThirdParty(@GetOrgFromRequest() organization: Organization) {
    return Promise.all(
      (
        await this._thirdPartyManager.getAllThirdPartiesByOrganization(
          organization.id
        )
      ).map((thirdParty) => {
        const { description, fields, position, title, identifier } =
          this._thirdPartyManager.getThirdPartyByName(thirdParty.identifier);
        return {
          ...thirdParty,
          title,
          position,
          fields,
          description,
        };
      })
    );
  }

  @Delete('/:id')
  deleteById(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    return this._thirdPartyManager.deleteIntegration(organization.id, id);
  }

  @Post('/:id/submit')
  async generate(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() data: any
  ) {
    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    const loadedData = await thirdPartyInstance?.instance?.sendData(
      AuthService.fixedDecryption(thirdParty.apiKey),
      data
    );

    const file = await this.storage.uploadSimple(loadedData);
    return this._mediaService.saveFile(
      organization.id,
      file.split('/').pop(),
      file
    );
  }

  @Post('/function/:id/:functionName')
  async callFunction(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Param('functionName') functionName: string,
    @Body() data: any
  ) {
    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    return thirdPartyInstance?.instance?.[functionName](
      AuthService.fixedDecryption(thirdParty.apiKey),
      data
    );
  }

  @Post('/:id/import')
  async importMedia(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: ImportMediaDto
  ) {
    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    const downloadUrls = await thirdPartyInstance?.instance?.['importMedia']?.(
      AuthService.fixedDecryption(thirdParty.apiKey),
      body.items
    );

    if (!downloadUrls || !Array.isArray(downloadUrls)) {
      throw new HttpException('Import not supported', 400);
    }

    const results = [];
    for (const item of downloadUrls) {
      const file = await this.storage.uploadSimple(item.url);
      const saved = await this._mediaService.saveFile(
        organization.id,
        item.name || file.split('/').pop(),
        file
      );
      results.push(saved);
    }

    return results;
  }

  @Post('/:identifier')
  async addApiKey(
    @GetOrgFromRequest() organization: Organization,
    @Param('identifier') identifier: string,
    @Body('api') api: string
  ) {
    const thirdParty = this._thirdPartyManager.getThirdPartyByName(identifier);
    if (!thirdParty) {
      throw new HttpException('Invalid identifier', 400);
    }

    const connect = await thirdParty.instance.checkConnection(api);
    if (!connect) {
      throw new HttpException('Invalid API key', 400);
    }

    try {
      const save = await this._thirdPartyManager.saveIntegration(
        organization.id,
        identifier,
        api,
        {
          name: connect.name,
          username: connect.username,
          id: connect.id,
        }
      );

      return {
        id: save.id,
      };
    } catch (e) {
      console.log(e);
      throw new HttpException('Integration Already Exists', 400);
    }
  }
}
