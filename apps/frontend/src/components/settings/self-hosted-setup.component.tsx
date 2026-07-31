'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useCredentialsList } from '@gitroom/frontend/hooks/use-credentials.hook';
import { useAiCredentialsList } from '@gitroom/frontend/hooks/use-ai-credentials.hook';
import { useVariables } from '@gitroom/react/helpers/variable.context';

type SetupStep = {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  action: string;
  tab?: string;
  href?: string;
};

export const SelfHostedSetup: React.FC<{
  onNavigate: (tab: string) => void;
}> = ({ onNavigate }) => {
  const { data: credentials, isLoading: credentialsLoading } =
    useCredentialsList();
  const { data: aiCredentials, isLoading: aiLoading } =
    useAiCredentialsList();
  const { frontEndUrl } = useVariables();

  const configuredProviders = useMemo(
    () => new Set((credentials || []).map((item) => item.provider)),
    [credentials]
  );

  const steps: SetupStep[] = [
    {
      id: 'meta',
      title: 'Aplicativos das redes sociais',
      description:
        'Adicione os IDs e segredos dos aplicativos Meta e das outras redes que serão usadas.',
      complete: configuredProviders.has('facebook'),
      action: 'Configurar credenciais',
      tab: 'credentials',
    },
    {
      id: 'ai',
      title: 'Modelo de texto',
      description:
        'Defina a API OpenAI compatível, OpenAI ou OpenRouter usada pelo agente e pelos textos.',
      complete: !!aiCredentials?.some((item) => item.kind === 'TEXT'),
      action: 'Configurar IA',
      tab: 'ai_provider',
    },
    {
      id: 'media',
      title: 'Design e banco de imagens',
      description:
        'Configure Canva, Pexels e, opcionalmente, Polotno para importar designs, pesquisar imagens e licenciar o editor.',
      complete:
        configuredProviders.has('canva') &&
        configuredProviders.has('pexels'),
      action: 'Configurar mídia',
      tab: 'credentials',
    },
    {
      id: 'channels',
      title: 'Contas sociais',
      description:
        'Conecte os perfis do Instagram, Facebook e demais canais que publicarão o conteúdo.',
      complete: false,
      action: 'Conectar canais',
      href: '/launches',
    },
  ];

  const completed = steps.filter((step) => step.complete).length;
  const loading = credentialsLoading || aiLoading;

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-col gap-[6px]">
        <h3 className="text-[20px] font-semibold">Preparar esta instalação</h3>
        <p className="text-[14px] text-customColor18">
          {frontEndUrl || 'DestinyPost'} está ativo. Termine as conexões para
          começar a publicar.
        </p>
      </div>

      <div className="flex items-center gap-[12px]">
        <div className="h-[6px] flex-1 bg-fifth overflow-hidden rounded-[3px]">
          <div
            className="h-full bg-btnPrimary transition-all"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>
        <span className="text-[13px] text-customColor18 whitespace-nowrap">
          {loading ? 'Verificando...' : `${completed} de ${steps.length}`}
        </span>
      </div>

      <div className="border border-newTableBorder rounded-[6px] divide-y divide-newTableBorder">
        {steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center justify-between gap-[18px] p-[16px]"
          >
            <div className="flex items-start gap-[12px] min-w-0">
              <span
                className={
                  step.complete
                    ? 'mt-[3px] w-[12px] h-[12px] rounded-full bg-customColor42 shrink-0'
                    : 'mt-[3px] w-[12px] h-[12px] rounded-full border-2 border-customColor18 shrink-0'
                }
                aria-label={step.complete ? 'Concluído' : 'Pendente'}
              />
              <div className="flex flex-col gap-[3px] min-w-0">
                <div className="text-[14px] font-[600]">{step.title}</div>
                <div className="text-[13px] text-customColor18">
                  {step.description}
                </div>
              </div>
            </div>

            {step.href ? (
              <Link
                href={step.href}
                className="h-[36px] px-[14px] inline-flex items-center bg-btnPrimary text-white rounded-[4px] text-[13px] whitespace-nowrap"
              >
                {step.action}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => step.tab && onNavigate(step.tab)}
                className="h-[36px] px-[14px] bg-btnPrimary text-white rounded-[4px] text-[13px] whitespace-nowrap"
              >
                {step.action}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Link
          href="/launches"
          className="h-[40px] px-[18px] inline-flex items-center bg-btnPrimary text-white rounded-[4px] text-[14px]"
        >
          Ir para os canais
        </Link>
      </div>
    </div>
  );
};
