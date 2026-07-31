import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetProfileFromRequest } from '@gitroom/nestjs-libraries/user/profile.from.request';
import { Organization, Profile } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { GenerateImageBodyDto } from '@gitroom/nestjs-libraries/dtos/ai/image.dto';
import { ImageMode } from '@gitroom/nestjs-libraries/ai/ai-image.service';
import { Throttle } from '@nestjs/throttler';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService,
    private _credentialService: CredentialService
  ) {}

  @Delete('/:id')
  deleteMedia(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Param('id') id: string
  ) {
    return this._mediaService.deleteMedia(org.id, id, profile?.id);
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    console.log('hello');
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false,
    aspectRatio?: '1:1' | '9:16' | '16:9',
    extra?: { mode?: ImageMode; referenceImageUrl?: string }
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (total.credits <= 0) {
      return false;
    }

    return {
      output:
        (isPicturePrompt ? '' : 'data:image/png;base64,') +
        (await this._mediaService.generateImage(
          prompt,
          org,
          isPicturePrompt,
          profile?.id,
          aspectRatio,
          extra
        )),
    };
  }

  @Post('/generate-image-with-prompt')
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Req() req: Request,
    @Body() body: GenerateImageBodyDto
  ) {
    // skipEnrich=true => o prompt vai cru pro modelo (sem
    // generatePromptForPicture). Default false: enriquece.
    const isPicturePrompt = !body.skipEnrich;

    const image = await this.generateImage(
      org,
      profile,
      req,
      body.prompt,
      isPicturePrompt,
      body.aspectRatio,
      {
        mode: body.mode,
        referenceImageUrl: body.referenceImageUrl,
      }
    );
    if (!image) {
      return false;
    }

    // `generateImage` com `isPicturePrompt=true` retorna `output` como
    // base64 puro (sem prefix `data:`). `uploadSimple` espera URL ou
    // data URL, entao montamos o prefix aqui antes de delegar — caso
    // contrario o helper cai em fetch(base64Puro) e undici joga erro
    // "Failed to parse URL".
    const payload = image.output.startsWith('data:')
      ? image.output
      : `data:image/png;base64,${image.output}`;
    const file = await this.storage.uploadSimple(payload);

    return this._mediaService.saveFile(
      org.id,
      file.split('/').pop(),
      file,
      undefined,
      profile?.id
    );
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('/stock/search')
  async searchStockPhotos(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Query('query') rawQuery: string,
    @Query('page') rawPage: string = '1'
  ) {
    const stored = await this._credentialService.getRaw(
      org.id,
      'pexels'
    );
    const apiKey = String(
      stored?.apiKey || process.env.PEXELS_API_KEY || ''
    ).trim();
    if (!apiKey) {
      throw new HttpException(
        'Banco de imagens ainda nao configurado. Adicione a chave Pexels em Configuracoes > Credenciais.',
        412
      );
    }

    const query = String(rawQuery || '').trim().slice(0, 120);
    if (query.length < 2) {
      throw new HttpException('Digite pelo menos 2 caracteres para buscar.', 400);
    }
    const parsedPage = Number.parseInt(String(rawPage || '1'), 10);
    const page = Number.isFinite(parsedPage)
      ? Math.min(Math.max(parsedPage, 1), 50)
      : 1;
    const params = new URLSearchParams({
      query,
      page: String(page),
      per_page: '30',
      orientation: 'portrait',
      locale: 'pt-BR',
    });

    let response: globalThis.Response;
    try {
      response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new HttpException(
        'O banco de imagens demorou para responder. Tente novamente.',
        504
      );
    }
    if (!response.ok) {
      throw new HttpException(
        response.status === 429
          ? 'O limite de buscas do banco de imagens foi atingido.'
          : 'Nao foi possivel consultar o banco de imagens.',
        response.status === 429 ? 429 : 502
      );
    }

    const payload = (await response.json()) as {
      photos?: Array<{
        id?: number;
        width?: number;
        height?: number;
        url?: string;
        photographer?: string;
        photographer_url?: string;
        alt?: string;
        avg_color?: string;
        src?: {
          medium?: string;
          large2x?: string;
          portrait?: string;
          original?: string;
        };
      }>;
      total_results?: number;
      next_page?: string;
    };

    return {
      page,
      total: payload.total_results || 0,
      hasMore: Boolean(payload.next_page),
      photos: (payload.photos || [])
        .filter(
          (photo) =>
            photo.id &&
            photo.src?.medium &&
            (photo.src?.large2x || photo.src?.portrait || photo.src?.original)
        )
        .map((photo) => ({
          id: String(photo.id),
          width: photo.width || 0,
          height: photo.height || 0,
          preview: photo.src!.medium!,
          source:
            photo.src!.large2x ||
            photo.src!.portrait ||
            photo.src!.original!,
          alt: photo.alt || query,
          color: photo.avg_color || '#E5E5E5',
          photographer: photo.photographer || 'Pexels',
          photographerUrl: photo.photographer_url || 'https://www.pexels.com',
          photoUrl: photo.url || 'https://www.pexels.com',
        })),
    };
  }

  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('/stock/import')
  async importStockPhoto(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Body()
    body: {
      url?: string;
      photographer?: string;
      photographerUrl?: string;
      photoUrl?: string;
      alt?: string;
    }
  ) {
    let source: URL;
    try {
      source = new URL(String(body?.url || ''));
    } catch {
      throw new HttpException('Imagem do banco invalida.', 400);
    }
    if (
      source.protocol !== 'https:' ||
      source.hostname.toLowerCase() !== 'images.pexels.com'
    ) {
      throw new HttpException('Origem da imagem nao permitida.', 400);
    }

    const uploaded = await this.storage.uploadSimple(source.toString());
    const photographer = String(body?.photographer || 'Pexels')
      .trim()
      .slice(0, 100);
    const saved = await this._mediaService.saveFile(
      org.id,
      uploaded.split('/').pop() || `pexels-${Date.now()}.jpg`,
      uploaded,
      `Foto de ${photographer} no Pexels`,
      profile?.id
    );
    if (body?.alt) {
      await this._mediaService.saveMediaInformation(org.id, {
        id: saved.id,
        alt: String(body.alt).trim().slice(0, 500),
        thumbnail: undefined,
        thumbnailTimestamp: undefined,
      });
    }
    return {
      ...saved,
      attribution: {
        photographer,
        photographerUrl: String(
          body?.photographerUrl || 'https://www.pexels.com'
        ),
        photoUrl: String(body?.photoUrl || 'https://www.pexels.com'),
      },
    };
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @UploadedFile() file: Express.Multer.File
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName,
      profile?.id
    );
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined,
      profile?.id
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName,
      profile?.id
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('/upload-polotno-project')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    })
  )
  async uploadPolotnoProject(
    @UploadedFile('file') file: Express.Multer.File
  ) {
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new HttpException('Projeto editavel invalido.', 400);
    }

    let project: unknown;
    try {
      project = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new HttpException('O projeto editavel nao e um JSON valido.', 400);
    }

    if (
      !project ||
      typeof project !== 'object' ||
      !Array.isArray((project as { pages?: unknown }).pages) ||
      (project as { pages: unknown[] }).pages.length === 0 ||
      (project as { pages: unknown[] }).pages.length > 30
    ) {
      throw new HttpException(
        'O projeto precisa ter entre 1 e 30 paginas.',
        400
      );
    }

    const uploaded = await this.storage.uploadFile({
      ...file,
      mimetype: 'application/json',
      originalname: 'carrossel-editavel.json',
      size: file.buffer.length,
    });

    return { path: uploaded.path };
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload = await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload') {
      return upload;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;

    const saveFile = await this._mediaService.saveFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined,
      profile?.id
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Query('page') page: number
  ) {
    return this._mediaService.getMedia(org.id, page, profile?.id);
  }

  @Get('/video-options')
  getVideos() {
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  videoFunction(
    @Body() body: VideoFunctionDto
  ) {
    return this._mediaService.videoFunction(body.identifier, body.functionName, body.params);
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    return this._mediaService.generateVideoAllowed(org, type);
  }
}
