'use client';

import React, { FC, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  buildEditableCarouselDesign,
  EditableCarouselInput,
  EditableCarouselSlide,
} from '@gitroom/nestjs-libraries/chat/tools/carousel.design';
import { CarouselTemplate } from '@gitroom/nestjs-libraries/chat/tools/generate.carousel.schema';
import type {
  PolotnoProjectResult,
} from '@gitroom/frontend/components/launches/polonto';

const Polonto = dynamic(
  () => import('@gitroom/frontend/components/launches/polonto'),
  { ssr: false }
);

const templates: CarouselTemplate[] = [
  'authority',
  'editorial',
  'educational',
  'case-study',
];

const normalizeSlides = (value: unknown): EditableCarouselSlide[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, 10)
    .map((slide: any) => ({
      eyebrow:
        typeof slide?.eyebrow === 'string'
          ? slide.eyebrow.trim().slice(0, 50)
          : undefined,
      headline: String(slide?.headline || '')
        .trim()
        .slice(0, 120),
      body:
        typeof slide?.body === 'string'
          ? slide.body.trim().slice(0, 520)
          : undefined,
      imageQuery:
        typeof slide?.imageQuery === 'string'
          ? slide.imageQuery.trim().slice(0, 120)
          : undefined,
      imageUrl:
        typeof slide?.imageUrl === 'string' &&
        /^https:\/\//i.test(slide.imageUrl.trim())
          ? slide.imageUrl.trim()
          : undefined,
    }))
    .filter((slide) => slide.headline.length > 0);

const normalizeInput = (args: any): EditableCarouselInput => {
  const template = templates.includes(args?.template)
    ? args.template
    : 'authority';
  const palette = (Array.isArray(args?.palette) ? args.palette : [])
    .map((color: unknown) => String(color || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    template,
    brandName: String(args?.brandName || 'Minha marca').trim().slice(0, 80),
    username: String(args?.username || '')
      .trim()
      .replace(/^@/, '')
      .slice(0, 30),
    footer: String(args?.footer || '').trim().slice(0, 90) || undefined,
    palette: palette.length >= 2 ? palette : ['#101010', '#FFD43B', '#FFFFFF'],
    slides: normalizeSlides(args?.slides),
  };
};

export const CarouselEditorAction: FC<{
  args: any;
  respond: (value: any) => void;
}> = ({ args, respond }) => {
  const modals = useModals();
  const input = useMemo(() => normalizeInput(args), [args]);
  const initialDesign = useMemo(
    () => buildEditableCarouselDesign(input),
    [input]
  );
  const [saved, setSaved] = useState<PolotnoProjectResult | null>(null);

  const openEditor = () => {
    modals.openModal({
      title: 'Editor de carrossel',
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 32px)',
      height: 'calc(100% - 32px)',
      children: (close) => (
        <Polonto
          carousel
          initialDesign={(saved?.design || initialDesign) as Record<
            string,
            unknown
          >}
          setMedia={() => undefined}
          closeModal={close}
          onSaveProject={(project) => {
            setSaved(project);
            respond(
              JSON.stringify({
                status: 'carousel_saved',
                template: input.template,
                brandName: input.brandName,
                designPath: project.designPath,
                files: project.media.map((media, index) => ({
                  ...media,
                  index: index + 1,
                })),
                instruction:
                  'O carrossel foi revisado no editor e salvo. Mostre os slides em ordem e ofereca legenda e agendamento.',
              })
            );
          }}
        />
      ),
    });
  };

  if (input.slides.length < 3) {
    return (
      <section className="w-full max-w-[720px] rounded-[8px] border border-red-500/35 bg-red-500/5 p-[18px] text-textColor">
        <div className="font-semibold">Roteiro incompleto</div>
        <div className="text-[13px] opacity-70 mt-[4px]">
          O carrossel precisa ter pelo menos 3 slides. Gere novamente o roteiro
          com capa, desenvolvimento e CTA.
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-[760px] rounded-[8px] border border-fifth bg-newBgColorInner text-textColor overflow-hidden">
      <div className="grid grid-cols-[128px_1fr] min-h-[176px]">
        <div
          className="relative overflow-hidden border-r border-fifth p-[14px] flex flex-col justify-between"
          style={{
            background:
              input.palette[0] || 'var(--new-bg-color, #101010)',
            color: input.palette[2] || '#FFFFFF',
          }}
        >
          <span className="text-[9px] font-semibold uppercase opacity-70 truncate">
            {input.brandName}
          </span>
          <div className="relative z-[2] text-[15px] font-bold leading-[1.08] break-words">
            {input.slides[0].headline}
          </div>
          <div
            className="absolute w-[70px] h-[70px] right-[-18px] top-[28px] rounded-full opacity-80"
            style={{ background: input.palette[1] || '#FFD43B' }}
          />
          <span className="text-[9px] opacity-65">1/{input.slides.length}</span>
        </div>

        <div className="p-[18px] flex flex-col justify-center">
          <div className="flex items-center gap-[8px]">
            <span className="inline-flex h-[24px] px-[8px] items-center rounded-[5px] bg-btnPrimary text-white text-[10px] font-semibold uppercase">
              Editavel
            </span>
            <span className="text-[12px] opacity-60">
              {input.slides.length} slides em 1080 x 1350
            </span>
          </div>
          <h3 className="text-[18px] font-semibold mt-[10px]">
            {saved ? 'Carrossel salvo com sucesso' : 'Seu carrossel esta pronto para editar'}
          </h3>
          <p className="text-[13px] opacity-70 mt-[5px] max-w-[520px]">
            Troque textos, fontes, cores e imagens. Use o banco de fotos, envie
            arquivos proprios ou gere uma imagem com IA apenas quando precisar.
          </p>
          {saved ? (
            <div className="mt-[12px] flex gap-[8px] overflow-x-auto pb-[4px]">
              {saved.media.map((media, index) => (
                <a
                  key={`${media.id}-${index}`}
                  href={media.path}
                  target="_blank"
                  rel="noreferrer"
                  className="relative h-[88px] w-[70px] shrink-0 overflow-hidden rounded-[5px] border border-fifth bg-newBgColor"
                  title={`Abrir slide ${index + 1}`}
                >
                  <img
                    src={media.path}
                    alt={`Slide ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-[3px] right-[3px] rounded-[3px] bg-black/70 px-[4px] py-[1px] text-[9px] text-white">
                    {index + 1}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-[10px] mt-[14px]">
            <button
              type="button"
              onClick={openEditor}
              className="h-[40px] px-[16px] rounded-[6px] bg-btnPrimary text-white font-medium"
            >
              {saved ? 'Editar novamente' : 'Abrir editor'}
            </button>
            {saved ? (
              <span className="text-[12px] text-green-500">
                {saved.media.length} slides na biblioteca
              </span>
            ) : (
              <span className="text-[11px] opacity-55">
                Nenhum credito de imagem e usado para editar
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
