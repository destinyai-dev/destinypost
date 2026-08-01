'use client';

import React, {
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CopilotChat, CopilotKitCSSProperties } from '@copilotkit/react-ui';
import {
  ErrorMessageProps,
  InputProps,
  UserMessageProps,
} from '@copilotkit/react-ui/dist/components/chat/props';
import { Input } from '@gitroom/frontend/components/agents/agent.input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  CopilotKit,
  useCopilotAction,
  useCopilotMessagesContext,
} from '@copilotkit/react-core';
import {
  MediaPortal,
  PropertiesContext,
} from '@gitroom/frontend/components/agents/agent';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { sanitizeChatContent } from '@gitroom/helpers/utils/sanitize.chat.content';
import { TextMessage } from '@copilotkit/runtime-client-gql';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { InstagramStrategyAction } from '@gitroom/frontend/components/agents/instagram-strategy.action';
import { CarouselEditorAction } from '@gitroom/frontend/components/agents/carousel-editor.action';

const CAROUSEL_START_MESSAGE = `Quero criar um carrossel para Instagram. O modo carrossel foi ativado.

Use o DNA da marca e a ideia aprovada mais recentes deste chat, caso existam. Se nao existirem, use a persona do perfil atual e me pergunte somente o tema, objetivo e CTA que estiverem faltando.

Quero um carrossel 4:5 consistente e profissional. Primeiro monte um roteiro curto com capa, desenvolvimento e CTA final para eu aprovar. Inclua uma busca de imagem sugerida em cada slide que precisar de foto. Depois da minha confirmacao, abra o carrossel no editor multipagina para eu revisar textos, cores, fontes e imagens antes de exportar.`;

// Classifica a mensagem crua de erro do streaming do agente (CopilotKit
// nao expoe status HTTP — o erro chega como texto). Espelha o mapeamento
// do backend `buildFriendlyProviderMessage` em ai-text.service.ts.
// Remove material sensivel (Bearer tokens, chaves sk-...) que o provedor
// possa ecoar na mensagem crua do stream, antes de exibir o "Detalhe".
// Espelha `sanitize()` de ai-text.service.ts / ai-video.service.ts.
const sanitize = (value: string): string =>
  (value || '')
    .replace(/Bearer\s+[A-Za-z0-9_.\-]+/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9_.\-]{6,}/gi, 'sk-***');

type AiErrorKind = 'config' | 'credits' | 'auth' | 'rate_limit' | 'generic';

const classifyAiError = (raw?: string): AiErrorKind => {
  const lower = (raw || '').toLowerCase();
  // Credencial nao configurada / nao compartilhada (HTTP 412 do
  // AiProviderResolverService). Verificado ANTES de auth para nao ser
  // confundido com erro de chave invalida.
  if (
    /modelos de ia|configure suas chaves|nao esta compartilhando|não está compartilhando|precondition|412/.test(
      lower
    )
  ) {
    return 'config';
  }
  if (
    /credit|insufficient|afford|quota|billing|payment|fund|saldo|402/.test(
      lower
    )
  ) {
    return 'credits';
  }
  if (
    /unauthor|api key|invalid.{0,12}key|authentication|forbidden|401|403/.test(
      lower
    )
  ) {
    return 'auth';
  }
  if (/rate.?limit|too many|429/.test(lower)) {
    return 'rate_limit';
  }
  return 'generic';
};

const friendlyAiErrorMessage = (
  raw: string | undefined,
  t: ReturnType<typeof useT>
): string => {
  switch (classifyAiError(raw)) {
    case 'config':
      return t(
        'ai_assistant_provider_not_configured',
        'Configure suas chaves de IA em Configurações > Modelos de IA. Se você usa um perfil secundário, verifique se o perfil padrão está compartilhando a credencial.'
      );
    case 'credits':
      return t(
        'ai_provider_no_credits',
        'Seu provedor de IA está sem créditos ou atingiu o limite de cobrança. Verifique o saldo na conta do provedor e tente novamente.'
      );
    case 'auth':
      return t(
        'ai_provider_auth_error',
        'Falha de autenticação no provedor de IA. Confira a chave de API em Configurações > Modelos de IA.'
      );
    case 'rate_limit':
      return t(
        'ai_provider_rate_limit',
        'O provedor de IA atingiu o limite de requisições. Aguarde alguns instantes e tente novamente.'
      );
    default:
      return t(
        'ai_assistant_generic_error',
        'O assistente encontrou um erro ao responder. Tente novamente em instantes.'
      );
  }
};

// Renderizado pelo CopilotChat quando o streaming do agente falha (ex.:
// provedor de IA sem creditos). Sem isso o usuario nao recebia feedback
// nenhum — o erro so aparecia no console (runChatCompletion).
const AgentErrorMessage: FC<ErrorMessageProps> = ({ error }) => {
  const t = useT();
  const raw = error?.message || '';
  return (
    <div className="copilotKitMessage copilotKitAssistantMessage !bg-red-500/10 border border-red-500/40 rounded-[8px] p-[12px] my-[8px] text-[14px]">
      <div className="font-semibold text-red-400 mb-[4px]">
        {t('ai_assistant_error_title', 'Não foi possível responder')}
      </div>
      <div className="opacity-90">{friendlyAiErrorMessage(raw, t)}</div>
      {raw ? (
        <div className="text-[11px] opacity-50 mt-[8px] break-words">
          {t('detail_label', 'Detalhe')}: {sanitize(raw)}
        </div>
      ) : null}
    </div>
  );
};

export const AgentChat: FC = () => {
  const { backendUrl } = useVariables();
  const params = useParams<{ id: string }>();
  const { properties } = useContext(PropertiesContext);
  const t = useT();
  const toaster = useToaster();

  return (
    <CopilotKit
      {...(params.id === 'new' ? {} : { threadId: params.id })}
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/agent'}
      showDevConsole={false}
      agent="postiz"
      properties={{
        integrations: properties,
      }}
    >
      <Hooks />
      <LoadMessages id={params.id} />
      <div
        style={
          {
            '--copilot-kit-primary-color': 'var(--new-btn-text)',
            '--copilot-kit-background-color': 'var(--new-bg-color)',
          } as CopilotKitCSSProperties
        }
        className="trz agent bg-newBgColorInner flex flex-col gap-[15px] transition-all flex-1 items-center relative"
      >
        <div className="absolute left-0 w-full h-full pb-[20px]">
          <CopilotChat
            className="w-full h-full"
            labels={{
              title: t('your_assistant', 'Your Assistant'),
              placeholder: t('agent_input_placeholder', 'Type a message...'),
              initial: t(
                'agent_welcome_message',
                `Hello, I am your Postiz agent 🙌🏻.
              
I can schedule a post or multiple posts to multiple channels and generate pictures and videos.

You can select the channels you want to use from the left menu.

You can see your previous conversations from the right menu.

You can also use me as an MCP Server, check Settings >> Public API
`
              ),
            }}
            UserMessage={Message}
            Input={NewInput}
            ErrorMessage={AgentErrorMessage}
            onError={(errorEvent) =>
              toaster.show(
                friendlyAiErrorMessage(
                  (errorEvent?.error as { message?: string })?.message,
                  t
                ),
                'warning'
              )
            }
          />
        </div>
      </div>
    </CopilotKit>
  );
};

const LoadMessages: FC<{ id: string }> = ({ id }) => {
  const { setMessages } = useCopilotMessagesContext();
  const fetch = useFetch();

  const loadMessages = useCallback(async (idToSet: string) => {
    const data = await (await fetch(`/copilot/${idToSet}/list`)).json();
    setMessages(
      data.uiMessages.map((p: any) => {
        return new TextMessage({
          content: p.content,
          role: p.role,
        });
      })
    );
  }, []);

  useEffect(() => {
    if (id === 'new') {
      setMessages([]);
      return;
    }
    loadMessages(id);
  }, [id]);

  return null;
};

const Message: FC<UserMessageProps> = (props) => {
  const convertContentToImagesAndVideo = useMemo(() => {
    const html = (props.message?.content || '')
      .replace(/Video: (http.*mp4\n)/g, (match, p1) => {
        return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${p1.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
      })
      .replace(/Image: (http.*\n)/g, (match, p1) => {
        return `<img src="${p1.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/\[\-\-ImageAnalysis\-\-\][\s\S]*?\[\-\-ImageAnalysis\-\-\]/g, () => {
        return ``;
      })
      .replace(/\[\-\-Media\-\-\](.*)\[\-\-Media\-\-\]/g, (match, p1) => {
        return `<div class="flex justify-center mt-[20px]">${p1}</div>`;
      })
      .replace(
        /(\[--integrations--\][\s\S]*?\[--integrations--\])/g,
        (match, p1) => {
          return ``;
        }
      );
    return sanitizeChatContent(html);
  }, [props.message?.content]);
  return (
    <div
      className="copilotKitMessage copilotKitUserMessage min-w-[300px]"
      dangerouslySetInnerHTML={{
        __html: convertContentToImagesAndVideo,
      }}
    />
  );
};
const NewInput: FC<InputProps> = (props) => {
  const [media, setMedia] = useState([] as { path: string; id: string }[]);
  const [value, setValue] = useState('');
  const [mediaAnalysisInProgress, setMediaAnalysisInProgress] = useState(false);
  const { properties } = useContext(PropertiesContext);
  const fetch = useFetch();
  const toaster = useToaster();

  const isImageAttachment = (attachment: { path: string; id: string }) =>
    !!attachment?.path &&
    !/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(attachment.path);

  const buildImageAnalysis = async (
    text: string,
    attachments: { path: string; id: string }[]
  ) => {
    const images = attachments.filter(isImageAttachment);
    if (!images.length) {
      return '';
    }

    const response = await fetch('/copilot/vision/analyze', {
      method: 'POST',
      body: JSON.stringify({
        prompt: text,
        images,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data?.message ||
          'Nao foi possivel analisar a imagem anexada no momento.'
      );
    }

    if (!data?.analysis) {
      return '';
    }

    return `\n\n[--ImageAnalysis--]\nAnalise visual das imagens anexadas, gerada antes da resposta do agente:\n${data.analysis}\n\nUse essa analise como fonte de verdade sobre as imagens anexadas. Nao diga que nao consegue ver a imagem; ela ja foi analisada acima.\n[--ImageAnalysis--]`;
  };

  const sendMessage = async (
    text: string,
    attachments: { path: string; id: string }[] = media
  ) => {
    if (props.inProgress || mediaAnalysisInProgress) {
      return;
    }

    let imageAnalysis = '';
    if (attachments.some(isImageAttachment)) {
      setMediaAnalysisInProgress(true);
      try {
        imageAnalysis = await buildImageAnalysis(text, attachments);
      } catch (error) {
        toaster.show((error as Error).message, 'warning');
        imageAnalysis = `\n\n[--ImageAnalysis--]\nNao foi possivel analisar automaticamente as imagens anexadas: ${(error as Error).message}\n[--ImageAnalysis--]`;
      } finally {
        setMediaAnalysisInProgress(false);
      }
    }

    const send = props.onSend(
      text +
        imageAnalysis +
        (attachments.length > 0
          ? '\n[--Media--]' +
            attachments
              .map((item) =>
                item.path.indexOf('mp4') > -1
                  ? `Video: ${item.path}`
                  : `Image: ${item.path}`
              )
              .join('\n') +
            '\n[--Media--]'
          : '') +
        `
${
  properties.length
    ? `[--integrations--]
Use the following social media platforms: ${JSON.stringify(
        properties.map((property) => ({
          id: property.id,
          platform: property.identifier,
          profilePicture: property.picture,
          additionalSettings: property.additionalSettings,
        }))
      )}
[--integrations--]`
    : ``
}`
    );
    setValue('');
    setMedia([]);
    return send;
  };

  return (
    <>
      <MediaPortal
        value={value}
        media={media}
        setMedia={(e) => setMedia(e.target.value)}
        carouselDisabled={props.inProgress || mediaAnalysisInProgress}
        onCreateCarousel={() => void sendMessage(CAROUSEL_START_MESSAGE, [])}
      />
      <Input
        {...props}
        inProgress={props.inProgress || mediaAnalysisInProgress}
        hideStopButton={props.hideStopButton || mediaAnalysisInProgress}
        onChange={setValue}
        onSend={(text) => void sendMessage(text)}
        onInstagramProfile={(username) =>
          void sendMessage(
            `Mapeie o perfil @${username} do Instagram. Analise os dados publicos, o link da bio e os conteudos recentes; depois abra o DNA da marca e as ideias de conteudo para eu revisar dentro deste chat.`,
            []
          )
        }
      />
    </>
  );
};

export const Hooks: FC = () => {
  const modals = useModals();

  useCopilotAction({
    name: 'analyzeInstagramProfile',
    description:
      'Map an Instagram username into an editable brand DNA and an unlimited stream of content ideas. Call this immediately when the user asks to analyze or use an Instagram @handle as reference.',
    parameters: [
      {
        name: 'username',
        type: 'string',
        description: 'Instagram username without the @ sign',
        required: true,
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status !== 'executing') return null;
      return (
        <InstagramStrategyAction
          username={String(args?.username || '')}
          respond={respond}
        />
      );
    },
  });

  useCopilotAction({
    name: 'createEditableCarousel',
    description:
      'Create a complete editable Instagram carousel in the visual editor. Call this only after the user approves the final slide outline. In the UI, prefer this action over generateCarouselTool because it lets the user edit text, colors, fonts, layouts and stock photos before export.',
    parameters: [
      {
        name: 'template',
        type: 'string',
        description:
          'One of: authority, editorial, educational, case-study',
        required: true,
      },
      {
        name: 'brandName',
        type: 'string',
        description: 'Brand or creator name shown on every slide',
        required: true,
      },
      {
        name: 'username',
        type: 'string',
        description: 'Instagram username without @',
      },
      {
        name: 'footer',
        type: 'string',
        description: 'Short footer used across the carousel',
      },
      {
        name: 'palette',
        type: 'string[]',
        description: 'Two to six brand colors, preferably hex values',
        required: true,
      },
      {
        name: 'slides',
        type: 'object[]',
        description: 'Three to ten approved carousel slides in final order',
        required: true,
        attributes: [
          {
            name: 'eyebrow',
            type: 'string',
            description: 'Short slide label, up to 50 characters',
          },
          {
            name: 'headline',
            type: 'string',
            description: 'Main editable headline, up to 120 characters',
          },
          {
            name: 'body',
            type: 'string',
            description: 'Concise supporting copy, preferably under 220 characters',
          },
          {
            name: 'imageQuery',
            type: 'string',
            description:
              'Concrete stock-photo search query for this slide. Use Portuguese and describe subject, setting and mood; never use a person name or copyrighted brand.',
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status !== 'executing') return null;
      return <CarouselEditorAction args={args} respond={respond} />;
    },
  });

  useCopilotAction({
    name: 'manualPosting',
    description:
      'This tool should be triggered when the user wants to manually add the generated post',
    parameters: [
      {
        name: 'list',
        type: 'object[]',
        description:
          'list of posts to schedule to different social media (integration ids)',
        attributes: [
          {
            name: 'integrationId',
            type: 'string',
            description: 'The integration id',
          },
          {
            name: 'date',
            type: 'string',
            description: 'UTC date of the scheduled post',
          },
          {
            name: 'settings',
            type: 'object',
            description: 'Settings for the integration [input:settings]',
          },
          {
            name: 'posts',
            type: 'object[]',
            description: 'list of posts / comments (one under another)',
            attributes: [
              {
                name: 'content',
                type: 'string',
                description: 'the content of the post',
              },
              {
                name: 'attachments',
                type: 'object[]',
                description: 'list of attachments',
                attributes: [
                  {
                    name: 'id',
                    type: 'string',
                    description: 'id of the attachment',
                  },
                  {
                    name: 'path',
                    type: 'string',
                    description: 'url of the attachment',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <OpenModal args={args} respond={respond} />;
      }

      return null;
    },
  });
  return null;
};

const OpenModal: FC<{
  respond: (value: any) => void;
  args: {
    list: {
      integrationId: string;
      date: string;
      settings?: Record<string, any>;
      posts: { content: string; attachments: { id: string; path: string }[] }[];
    }[];
  };
}> = ({ args, respond }) => {
  const modals = useModals();
  const { properties } = useContext(PropertiesContext);
  const startModal = useCallback(async () => {
    for (const integration of args.list) {
      const foundIntegration = properties.find(
        (p) => p.id === integration.integrationId
      );
      if (!foundIntegration) {
        continue;
      }
      await new Promise((res) => {
        const group = makeId(10);
        modals.openModal({
          id: 'add-edit-modal',
          closeOnClickOutside: false,
          removeLayout: true,
          fullScreen: true,
          closeOnEscape: false,
          withCloseButton: false,
          askClose: true,
          size: '80%',
          title: ``,
          classNames: {
            modal: 'w-[100%] max-w-[1400px] text-textColor',
          },
          children: (
            <ExistingDataContextProvider
              value={{
                group,
                integration: integration.integrationId,
                integrationPicture: foundIntegration.picture || '',
                settings: integration.settings || {},
                posts: integration.posts.map((p) => ({
                  approvedSubmitForOrder: 'NO',
                  content: p.content,
                  createdAt: new Date().toISOString(),
                  state: 'DRAFT',
                  id: makeId(10),
                  settings: JSON.stringify(integration.settings || {}),
                  group,
                  integrationId: integration.integrationId,
                  integration: foundIntegration,
                  publishDate: dayjs.utc(integration.date).toISOString(),
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                })),
              }}
            >
              <AddEditModal
                date={dayjs.utc(integration.date)}
                allIntegrations={properties}
                integrations={[foundIntegration]}
                onlyValues={integration.posts.map((p) => ({
                  content: p.content,
                  id: makeId(10),
                  settings: integration.settings || {},
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                }))}
                reopenModal={() => {}}
                mutate={() => res(true)}
              />
            </ExistingDataContextProvider>
          ),
        });
      });
    }

    respond('User scheduled all the posts');
  }, [args, respond, properties]);

  useEffect(() => {
    startModal();
  }, []);
  return (
    <div onClick={() => respond('continue')}>
      Opening manually ${JSON.stringify(args)}
    </div>
  );
};
