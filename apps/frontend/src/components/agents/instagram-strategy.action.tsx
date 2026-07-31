'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type BrandDna = {
  profileType: 'personal' | 'company';
  name: string;
  contentLanguage: string;
  description: string;
  targetAudience: string;
  communicationStyle: string;
  valueProposition: string;
  differentiators: string[];
  contentPillars: string[];
  offers: string[];
  visualDirection: {
    mood: string;
    palette: string[];
    imagery: string;
    typography: string;
  };
  strategySummary: string;
  confidence: 'low' | 'medium' | 'high';
};

type ContentIdea = {
  id: string;
  title: string;
  hook: string;
  format: 'carousel' | 'single_image' | 'reel' | 'story' | 'text';
  objective: string;
  angle: string;
  captionBrief: string;
  visualBrief: string;
};

type StrategyResult = {
  username: string;
  profile: {
    username: string;
    name?: string;
    biography?: string;
    website?: string;
    profilePictureUrl?: string;
    followersCount?: number;
    mediaCount?: number;
    media: Array<{
      id: string;
      mediaType: string;
      mediaUrl?: string;
      thumbnailUrl?: string;
      permalink?: string;
    }>;
  };
  brandDna: BrandDna;
  ideas: ContentIdea[];
  sources: Array<{ title: string; url: string }>;
  sourceType: 'meta' | 'web' | 'mixed';
  caveats: string[];
};

const loadingSteps = [
  'Coletando dados do perfil',
  'Lendo o link da bio e fontes publicas',
  'Gerando DNA e estrategia',
];

const formatLabels: Record<ContentIdea['format'], string> = {
  carousel: 'Carrossel',
  single_image: 'Imagem unica',
  reel: 'Reel',
  story: 'Story',
  text: 'Texto',
};

const inputClass =
  'w-full bg-newBgColor border border-fifth rounded-[6px] px-[12px] py-[10px] text-[14px] outline-none focus:border-btnText';

export const InstagramStrategyAction: FC<{
  username?: string;
  respond: (value: any) => void;
}> = ({ username, respond }) => {
  const fetch = useFetch();
  const t = useT();
  const normalizedUsername = useMemo(
    () =>
      String(username || '')
        .trim()
        .replace(/^@/, '')
        .toLowerCase(),
    [username]
  );
  const [phase, setPhase] = useState<'loading' | 'dna' | 'ideas' | 'error'>(
    'loading'
  );
  const [loadingStep, setLoadingStep] = useState(0);
  const [data, setData] = useState<StrategyResult | null>(null);
  const [brandDna, setBrandDna] = useState<BrandDna | null>(null);
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [editingIdea, setEditingIdea] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const startedFor = useRef('');

  const analyze = useCallback(async () => {
    if (!normalizedUsername) {
      setError('O Agent nao recebeu um arroba valido.');
      setPhase('error');
      return;
    }
    setPhase('loading');
    setLoadingStep(0);
    setError('');
    try {
      const response = await fetch('/copilot/instagram/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body?.message === 'string'
            ? body.message
            : 'Nao foi possivel analisar este perfil.'
        );
      }
      setData(body);
      setBrandDna(body.brandDna);
      setIdeas(body.ideas || []);
      setIdeaIndex(0);
      setLoadingStep(loadingSteps.length);
      setPhase('dna');
    } catch (err) {
      setError((err as Error).message || 'Falha ao analisar o perfil.');
      setPhase('error');
    }
  }, [fetch, normalizedUsername]);

  useEffect(() => {
    if (!normalizedUsername || startedFor.current === normalizedUsername)
      return;
    startedFor.current = normalizedUsername;
    analyze();
  }, [analyze, normalizedUsername]);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setInterval(() => {
      setLoadingStep((current) =>
        Math.min(current + 1, loadingSteps.length - 1)
      );
    }, 1_100);
    return () => window.clearInterval(timer);
  }, [phase]);

  const updateDna = <K extends keyof BrandDna>(key: K, value: BrandDna[K]) => {
    setBrandDna((current) =>
      current ? { ...current, [key]: value } : current
    );
  };

  const updateVisualDirection = (
    key: keyof BrandDna['visualDirection'],
    value: string | string[]
  ) => {
    setBrandDna((current) =>
      current
        ? {
            ...current,
            visualDirection: {
              ...current.visualDirection,
              [key]: value,
            },
          }
        : current
    );
  };

  const generateMore = useCallback(async () => {
    if (!brandDna || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await fetch('/copilot/instagram/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          brandDna,
          previousTitles: ideas.map((idea) => idea.title),
          count: 6,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof body?.message === 'string'
            ? body.message
            : 'Nao foi possivel gerar novas ideias.'
        );
      }
      const nextIdeas = Array.isArray(body) ? body : body?.ideas || [];
      setIdeas((current) => [...current, ...nextIdeas]);
      setIdeaIndex((current) =>
        current >= ideas.length - 1 ? ideas.length : current
      );
    } catch (err) {
      setError((err as Error).message || 'Falha ao gerar novas ideias.');
    } finally {
      setLoadingMore(false);
    }
  }, [brandDna, fetch, ideas, loadingMore, normalizedUsername]);

  const rejectIdea = () => {
    setEditingIdea(false);
    if (ideaIndex < ideas.length - 1) {
      setIdeaIndex((current) => current + 1);
      return;
    }
    generateMore();
  };

  const approveIdea = () => {
    if (!data || !brandDna || !ideas[ideaIndex]) return;
    respond(
      JSON.stringify({
        status: 'approved',
        username: normalizedUsername,
        profile: {
          name: data.profile.name,
          biography: data.profile.biography,
          website: data.profile.website,
          profilePictureUrl: data.profile.profilePictureUrl,
        },
        brandDna,
        selectedIdea: ideas[ideaIndex],
        instruction:
          'Use este DNA como contexto permanente deste chat. Agora faca apenas as perguntas que ainda faltam para montar o briefing visual.',
      })
    );
  };

  if (phase === 'loading') {
    return (
      <section className="w-full max-w-[720px] border border-fifth rounded-[8px] p-[20px] bg-newBgColorInner text-textColor">
        <ProfileTitle username={normalizedUsername} />
        <h3 className="text-[18px] font-semibold mt-[18px]">
          {t('instagram_mapping_title', 'Mapeando o perfil')}
        </h3>
        <div className="mt-[18px] flex flex-col gap-[12px]">
          {loadingSteps.map((step, index) => {
            const complete = index < loadingStep;
            const active = index === loadingStep;
            return (
              <div
                key={step}
                className="flex items-center gap-[10px] text-[14px]"
              >
                <span
                  className={`w-[18px] h-[18px] flex items-center justify-center ${
                    complete ? 'text-green-500' : 'text-textColor/55'
                  }`}
                >
                  {complete ? (
                    '✓'
                  ) : active ? (
                    <span className="block w-[16px] h-[16px] rounded-full border-2 border-btnText border-t-transparent animate-spin" />
                  ) : (
                    '○'
                  )}
                </span>
                <span className={active ? 'font-medium' : ''}>{step}</span>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (phase === 'error') {
    return (
      <section className="w-full max-w-[720px] border border-red-500/40 rounded-[8px] p-[20px] bg-red-500/5 text-textColor">
        <ProfileTitle username={normalizedUsername} />
        <h3 className="text-[17px] font-semibold mt-[16px]">
          Nao foi possivel concluir a analise
        </h3>
        <p className="text-[14px] opacity-75 mt-[6px]">{error}</p>
        <button
          type="button"
          onClick={analyze}
          className="mt-[16px] px-[16px] h-[40px] rounded-[6px] bg-btnPrimary text-white"
        >
          Tentar novamente
        </button>
      </section>
    );
  }

  if (phase === 'dna' && data && brandDna) {
    return (
      <section className="w-full max-w-[760px] border border-fifth rounded-[8px] bg-newBgColorInner text-textColor overflow-hidden">
        <div className="p-[20px] border-b border-fifth">
          <ProfileTitle
            username={normalizedUsername}
            avatar={data.profile.profilePictureUrl}
          />
          <h3 className="text-[20px] font-semibold mt-[16px]">DNA da marca</h3>
          <p className="text-[13px] opacity-65 mt-[3px]">
            Revise a leitura estrategica antes de gerar as ideias.
          </p>
        </div>

        <div className="p-[20px] flex flex-col gap-[18px] max-h-[560px] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-[14px]">
            <label className="text-[13px] font-medium">
              Tipo de perfil
              <div className="grid grid-cols-2 mt-[7px] border border-fifth rounded-[6px] overflow-hidden">
                {[
                  ['personal', 'Pessoal'],
                  ['company', 'Empresa'],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() =>
                      updateDna('profileType', value as BrandDna['profileType'])
                    }
                    className={`h-[40px] text-[13px] ${
                      brandDna.profileType === value
                        ? 'bg-btnPrimary text-white'
                        : 'bg-newBgColor'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>
            <label className="text-[13px] font-medium">
              Nome
              <input
                className={`${inputClass} mt-[7px]`}
                value={brandDna.name}
                onChange={(event) => updateDna('name', event.target.value)}
              />
            </label>
          </div>

          <DnaTextarea
            label="Descricao"
            helper="O que a pessoa ou empresa faz, para quem e qual problema resolve."
            value={brandDna.description}
            onChange={(value) => updateDna('description', value)}
          />
          <DnaTextarea
            label="Publico-alvo"
            helper="Quem deve se identificar, acompanhar e comprar."
            value={brandDna.targetAudience}
            onChange={(value) => updateDna('targetAudience', value)}
          />
          <DnaTextarea
            label="Estilo de comunicacao"
            helper="Tom, vocabulario, ritmo, CTA e uso de elementos visuais."
            value={brandDna.communicationStyle}
            onChange={(value) => updateDna('communicationStyle', value)}
          />
          <DnaTextarea
            label="Proposta de valor"
            value={brandDna.valueProposition}
            onChange={(value) => updateDna('valueProposition', value)}
          />

          <TagEditor
            label="Pilares de conteudo"
            values={brandDna.contentPillars}
            onChange={(values) => updateDna('contentPillars', values)}
          />

          <div className="border-t border-fifth pt-[18px]">
            <h4 className="font-semibold text-[15px]">Direcao visual</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mt-[12px]">
              <label className="text-[13px] font-medium">
                Atmosfera
                <input
                  className={`${inputClass} mt-[7px]`}
                  value={brandDna.visualDirection.mood}
                  onChange={(event) =>
                    updateVisualDirection('mood', event.target.value)
                  }
                />
              </label>
              <label className="text-[13px] font-medium">
                Tipografia
                <input
                  className={`${inputClass} mt-[7px]`}
                  value={brandDna.visualDirection.typography}
                  onChange={(event) =>
                    updateVisualDirection('typography', event.target.value)
                  }
                />
              </label>
            </div>
            <DnaTextarea
              className="mt-[14px]"
              label="Imagens e composicao"
              value={brandDna.visualDirection.imagery}
              onChange={(value) => updateVisualDirection('imagery', value)}
            />
            <TagEditor
              className="mt-[14px]"
              label="Paleta sugerida"
              values={brandDna.visualDirection.palette}
              onChange={(values) => updateVisualDirection('palette', values)}
            />
          </div>

          {data.caveats.length > 0 ? (
            <div className="text-[12px] opacity-65 border-t border-fifth pt-[14px]">
              {data.caveats.join(' ')}
            </div>
          ) : null}
        </div>

        <div className="p-[16px] border-t border-fifth flex gap-[10px]">
          <button
            type="button"
            onClick={analyze}
            className="h-[44px] px-[18px] rounded-[6px] border border-fifth"
          >
            Reanalisar
          </button>
          <button
            type="button"
            onClick={() => setPhase('ideas')}
            className="h-[44px] flex-1 rounded-[6px] bg-btnPrimary text-white font-medium"
          >
            Gerar ideias →
          </button>
        </div>
      </section>
    );
  }

  const idea = ideas[ideaIndex];
  return (
    <section className="w-full max-w-[720px] text-textColor">
      <div className="flex items-center justify-between gap-[14px] mb-[12px]">
        <div>
          <ProfileTitle
            username={normalizedUsername}
            avatar={data?.profile.profilePictureUrl}
          />
          <h3 className="text-[19px] font-semibold mt-[10px]">
            Escolha uma ideia de conteudo
          </h3>
        </div>
        <span className="text-[12px] opacity-60 whitespace-nowrap">
          {ideaIndex + 1} de {ideas.length}
        </span>
      </div>

      <div className="h-[4px] bg-fifth rounded-full overflow-hidden mb-[14px]">
        <div
          className="h-full bg-btnPrimary transition-all"
          style={{
            width: `${Math.max(
              5,
              ((ideaIndex + 1) / Math.max(ideas.length, 1)) * 100
            )}%`,
          }}
        />
      </div>

      {idea ? (
        <article className="border border-fifth rounded-[8px] bg-newBgColorInner overflow-hidden">
          <div className="p-[20px]">
            <div className="flex items-center justify-between gap-[12px]">
              <span className="text-[11px] uppercase font-semibold tracking-wide opacity-60">
                {formatLabels[idea.format]} · {idea.objective}
              </span>
              <button
                type="button"
                onClick={() => setEditingIdea((current) => !current)}
                className="w-[34px] h-[34px] flex items-center justify-center rounded-[6px] border border-fifth"
                title="Editar ideia"
              >
                ✎
              </button>
            </div>

            {editingIdea ? (
              <div className="mt-[14px] flex flex-col gap-[12px]">
                <textarea
                  className={`${inputClass} min-h-[84px] resize-y`}
                  value={idea.title}
                  onChange={(event) =>
                    setIdeas((current) =>
                      current.map((item, index) =>
                        index === ideaIndex
                          ? { ...item, title: event.target.value }
                          : item
                      )
                    )
                  }
                />
                <textarea
                  className={`${inputClass} min-h-[84px] resize-y`}
                  value={idea.visualBrief}
                  onChange={(event) =>
                    setIdeas((current) =>
                      current.map((item, index) =>
                        index === ideaIndex
                          ? { ...item, visualBrief: event.target.value }
                          : item
                      )
                    )
                  }
                />
              </div>
            ) : (
              <>
                <h4 className="text-[20px] leading-[1.35] font-semibold mt-[18px]">
                  {idea.title}
                </h4>
                <p className="text-[14px] mt-[14px] opacity-80">
                  <strong>Gancho:</strong> {idea.hook}
                </p>
                <p className="text-[13px] mt-[10px] opacity-65">{idea.angle}</p>
                <div className="mt-[16px] pt-[14px] border-t border-fifth text-[13px] opacity-75">
                  {idea.visualBrief}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-[10px] p-[14px] border-t border-fifth">
            <button
              type="button"
              onClick={rejectIdea}
              disabled={loadingMore}
              className="h-[46px] rounded-[6px] border border-fifth disabled:opacity-50"
            >
              {loadingMore ? 'Gerando...' : 'Descartar'}
            </button>
            <button
              type="button"
              onClick={approveIdea}
              className="h-[46px] rounded-[6px] bg-btnPrimary text-white font-medium"
            >
              Escolher esta ideia ✓
            </button>
          </div>
        </article>
      ) : (
        <div className="h-[240px] border border-fifth rounded-[8px] flex items-center justify-center">
          <span className="animate-pulse">Gerando ideias...</span>
        </div>
      )}

      <div className="flex justify-between items-center gap-[10px] mt-[12px]">
        <button
          type="button"
          onClick={() => setPhase('dna')}
          className="text-[13px] opacity-75 hover:opacity-100"
        >
          ← Revisar DNA
        </button>
        <button
          type="button"
          onClick={generateMore}
          disabled={loadingMore}
          className="h-[38px] px-[14px] rounded-[6px] border border-fifth text-[13px] disabled:opacity-50"
        >
          {loadingMore ? 'Gerando...' : '+ Gerar mais ideias'}
        </button>
      </div>
      {error ? (
        <p className="text-red-400 text-[12px] mt-[10px]">{error}</p>
      ) : null}
    </section>
  );
};

const ProfileTitle: FC<{ username: string; avatar?: string }> = ({
  username,
  avatar,
}) => (
  <div className="flex items-center gap-[10px] min-w-0">
    {avatar ? (
      <img
        src={avatar}
        alt=""
        className="w-[38px] h-[38px] rounded-full object-cover border border-fifth"
        referrerPolicy="no-referrer"
      />
    ) : (
      <span className="w-[38px] h-[38px] rounded-full bg-pink-500/10 text-pink-400 flex items-center justify-center font-semibold">
        @
      </span>
    )}
    <div className="min-w-0">
      <div className="text-[12px] opacity-55">Referencia do chat</div>
      <div className="font-semibold truncate">@{username}</div>
    </div>
  </div>
);

const DnaTextarea: FC<{
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}> = ({ label, helper, value, onChange, className = '' }) => (
  <label className={`text-[13px] font-medium ${className}`}>
    {label}
    {helper ? (
      <span className="block text-[11px] font-normal opacity-55 mt-[2px]">
        {helper}
      </span>
    ) : null}
    <textarea
      className={`${inputClass} mt-[7px] min-h-[92px] resize-y`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);

const TagEditor: FC<{
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  className?: string;
}> = ({ label, values, onChange, className = '' }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <div className={className}>
      <div className="text-[13px] font-medium">{label}</div>
      <div className="flex flex-wrap gap-[7px] mt-[8px]">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-[6px] rounded-[6px] border border-fifth px-[9px] py-[6px] text-[12px]"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remover ${value}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-[8px] mt-[9px]">
        <input
          className={`${inputClass} h-[38px]`}
          value={draft}
          placeholder="Adicionar"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="w-[40px] h-[38px] rounded-[6px] border border-fifth"
          aria-label={`Adicionar em ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
};
