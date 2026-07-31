'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

type CanvaDesign = {
  id: string;
  title?: string;
  page_count?: number;
  thumbnail?: {
    url: string;
    width: number;
    height: number;
  };
  urls: {
    edit_url: string;
    view_url: string;
  };
};

type CanvaMedia = {
  id: string;
  path: string;
  alt?: string;
  thumbnail?: string;
};

const contentToHtml = (content: string) =>
  content
    .split(/\r?\n/)
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')}</p>`
    )
    .join('');

const CanvaImportDialog: FC<{
  design: CanvaDesign;
  close: () => void;
}> = ({ design, close }) => {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const toaster = useToaster();
  const { mutate } = useSWRConfig();
  const { data: integrations = [], isLoading } = useIntegrationList();
  const [integrationId, setIntegrationId] = useState('');
  const [caption, setCaption] = useState('');
  const [importing, setImporting] = useState(false);
  const selectedIntegrationId =
    integrationId || String(integrations[0]?.id || '');

  const importDesign = useCallback(async () => {
    if (!selectedIntegrationId) {
      toaster.show(
        t(
          'canva_choose_channel',
          'Conecte ou selecione um canal antes de importar.'
        ),
        'warning'
      );
      return;
    }

    setImporting(true);
    try {
      const importResponse = await fetch(
        `/third-party/canva/designs/${encodeURIComponent(design.id)}/import`,
        { method: 'POST' }
      );
      const imported = await importResponse.json();
      if (!importResponse.ok || !Array.isArray(imported.media)) {
        throw new Error(
          imported.message ||
            t('canva_import_failed', 'Não foi possível importar este design.')
        );
      }

      const media = imported.media.map((item: CanvaMedia) => ({
        id: item.id,
        path: item.path,
        ...(item.alt ? { alt: item.alt } : {}),
        ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
      }));
      const draftResponse = await fetch('/posts', {
        method: 'POST',
        body: JSON.stringify({
          type: 'draft',
          shortLink: false,
          date: new Date().toISOString(),
          tags: [],
          posts: [
            {
              integration: { id: selectedIntegrationId },
              value: [
                {
                  content: contentToHtml(caption.trim()),
                  image: media,
                  delay: 0,
                },
              ],
            },
          ],
        }),
      });
      const draft = await draftResponse.json().catch(() => ({}));
      if (!draftResponse.ok) {
        throw new Error(
          draft.message ||
            t(
              'canva_draft_failed',
              'As imagens foram salvas, mas o rascunho não pôde ser criado.'
            )
        );
      }

      await mutate(
        (key: unknown) =>
          typeof key === 'string' &&
          (key.startsWith('/posts-') ||
            key.startsWith('/posts-list-') ||
            key === '/media'),
        undefined,
        { revalidate: true }
      );
      toaster.show(
        t(
          'canva_draft_created',
          '{{count}} página(s) importada(s) em um novo rascunho.',
          { count: media.length }
        ),
        'success'
      );
      close();
      router.push('/launches');
    } catch (error) {
      toaster.show(
        (error as Error).message ||
          t('canva_import_failed', 'Não foi possível importar este design.'),
        'warning'
      );
    } finally {
      setImporting(false);
    }
  }, [
    caption,
    close,
    design.id,
    fetch,
    mutate,
    router,
    selectedIntegrationId,
    t,
    toaster,
  ]);

  return (
    <div className="fixed inset-0 z-[500] bg-black/55 flex items-center justify-center p-[16px]">
      <section className="w-full max-w-[560px] rounded-[8px] border border-tableBorder bg-newBgColorInner p-[20px] text-textColor">
        <div className="flex items-start justify-between gap-[16px]">
          <div>
            <h3 className="text-[18px] font-[600]">
              {t('canva_import_title', 'Importar para publicação')}
            </h3>
            <p className="text-[13px] text-customColor6 mt-[4px]">
              {design.title || t('canva_untitled', 'Design sem título')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('close', 'Fechar')}
            onClick={close}
            className="w-[32px] h-[32px] text-[22px] flex items-center justify-center hover:bg-boxHover rounded-[6px]"
          >
            ×
          </button>
        </div>

        <label className="block text-[13px] font-[500] mt-[20px]">
          {t('canva_destination_channel', 'Canal de destino')}
        </label>
        <select
          value={selectedIntegrationId}
          onChange={(event) => setIntegrationId(event.target.value)}
          disabled={isLoading || !integrations.length}
          className="w-full h-[42px] mt-[7px] px-[10px] rounded-[6px] border border-tableBorder bg-input text-textColor"
        >
          {!integrations.length && (
            <option value="">
              {t('canva_no_channels', 'Nenhum canal conectado')}
            </option>
          )}
          {integrations.map((integration: any) => (
            <option key={integration.id} value={integration.id}>
              {integration.name} ({integration.identifier})
            </option>
          ))}
        </select>

        <label className="block text-[13px] font-[500] mt-[16px]">
          {t('canva_caption', 'Legenda inicial')}
        </label>
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder={t(
            'canva_caption_placeholder',
            'Escreva uma legenda agora ou deixe em branco para editar depois.'
          )}
          className="w-full min-h-[120px] mt-[7px] p-[10px] rounded-[6px] border border-tableBorder bg-input text-textColor resize-y"
        />

        <p className="text-[12px] text-customColor6 mt-[10px]">
          {t(
            'canva_import_explanation',
            'Cada página do design será salva como uma imagem e adicionada ao rascunho na ordem correta.'
          )}
        </p>

        <div className="flex justify-end gap-[10px] mt-[20px]">
          <Button onClick={close}>{t('cancel', 'Cancelar')}</Button>
          <Button
            loading={importing}
            disabled={!selectedIntegrationId}
            onClick={importDesign}
          >
            {t('canva_create_draft', 'Criar rascunho')}
          </Button>
        </div>
      </section>
    </div>
  );
};

export const CanvaDesignsComponent: FC<{
  accountName: string;
  onDisconnected: () => void;
}> = ({ accountName, onDisconnected }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [selectedDesign, setSelectedDesign] = useState<CanvaDesign | null>(
    null
  );
  const cursor = pageCursors[pageIndex];

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (activeSearch) params.set('query', activeSearch);
    if (cursor) params.set('continuation', cursor);
    const suffix = params.toString();
    return `/third-party/canva/designs${suffix ? `?${suffix}` : ''}`;
  }, [activeSearch, cursor]);

  const loadDesigns = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.message ||
            t('canva_load_failed', 'Não foi possível carregar seus designs.')
        );
      }
      return data as { items: CanvaDesign[]; continuation?: string };
    },
    [fetch, t]
  );

  const { data, isLoading, error, mutate } = useSWR(endpoint, loadDesigns, {
    revalidateOnFocus: false,
  });

  const runSearch = useCallback(() => {
    setActiveSearch(search.trim());
    setPageIndex(0);
    setPageCursors([undefined]);
  }, [search]);

  const nextPage = useCallback(() => {
    if (!data?.continuation) return;
    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = data.continuation;
      return next;
    });
    setPageIndex((current) => current + 1);
  }, [data?.continuation, pageIndex]);

  const disconnect = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'canva_disconnect_confirm',
          'Desconectar o Canva desta conta? Os designs já importados continuarão na biblioteca.'
        )
      ))
    ) {
      return;
    }

    const response = await fetch('/third-party/canva', {
      method: 'DELETE',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      toaster.show(
        result.message ||
          t('canva_disconnect_failed', 'Não foi possível desconectar o Canva.'),
        'warning'
      );
      return;
    }

    toaster.show(
      t('canva_disconnected', 'Canva desconectado com sucesso.'),
      'success'
    );
    onDisconnected();
  }, [fetch, onDisconnected, t, toaster]);

  return (
    <section className="w-full border-b border-tableBorder pb-[20px] mb-[8px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px] mb-[16px]">
        <div>
          <h2 className="text-[18px] font-[600]">
            {t('canva_your_designs', 'Seus designs do Canva')}
          </h2>
          <p className="text-[13px] text-customColor6 mt-[4px]">
            {t('canva_connected_account', 'Conta conectada: {{name}}', {
              name: accountName,
            })}
          </p>
        </div>
        <div className="flex gap-[8px]">
          <Button onClick={() => mutate()}>{t('refresh', 'Atualizar')}</Button>
          <Button onClick={disconnect}>
            {t('canva_disconnect', 'Desconectar Canva')}
          </Button>
        </div>
      </div>

      <div className="flex gap-[8px] mb-[16px]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runSearch();
          }}
          placeholder={t('canva_search', 'Buscar designs no Canva')}
          className="h-[42px] flex-1 px-[12px] rounded-[6px] border border-tableBorder bg-input text-textColor"
        />
        <Button onClick={runSearch}>{t('search', 'Buscar')}</Button>
      </div>

      {isLoading && (
        <div className="min-h-[160px] flex items-center justify-center text-customColor6">
          {t('canva_loading', 'Carregando designs...')}
        </div>
      )}

      {error && (
        <div className="min-h-[120px] flex items-center justify-center text-red-500">
          {error.message}
        </div>
      )}

      {!isLoading && !error && !data?.items?.length && (
        <div className="min-h-[120px] flex items-center justify-center text-customColor6">
          {t('canva_no_designs', 'Nenhum design foi encontrado nesta conta.')}
        </div>
      )}

      {!!data?.items?.length && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[12px]">
            {data.items.map((design) => (
              <article
                key={design.id}
                className="border border-tableBorder rounded-[8px] overflow-hidden bg-newTableHeader"
              >
                <div className="aspect-square bg-newBgColor flex items-center justify-center overflow-hidden">
                  {design.thumbnail?.url ? (
                    <img
                      src={design.thumbnail.url}
                      alt={design.title || t('canva_design', 'Design do Canva')}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-customColor6">
                      {t('canva_no_preview', 'Sem prévia')}
                    </span>
                  )}
                </div>
                <div className="p-[12px]">
                  <div
                    className="font-[500] text-[14px] truncate"
                    title={
                      design.title || t('canva_untitled', 'Design sem título')
                    }
                  >
                    {design.title || t('canva_untitled', 'Design sem título')}
                  </div>
                  <div className="text-[12px] text-customColor6 mt-[3px]">
                    {t('canva_page_count', '{{count}} página(s)', {
                      count: design.page_count || 1,
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-[8px] mt-[12px]">
                    <a
                      href={design.urls.edit_url}
                      target="_blank"
                      rel="noreferrer"
                      className="h-[36px] border border-tableBorder rounded-[6px] flex items-center justify-center text-[13px] hover:bg-boxHover"
                    >
                      {t('canva_edit', 'Editar no Canva')}
                    </a>
                    <Button
                      onClick={() => setSelectedDesign(design)}
                      className="w-full"
                    >
                      {t('canva_import', 'Importar')}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between mt-[16px]">
            <Button
              disabled={pageIndex === 0}
              onClick={() =>
                setPageIndex((current) => Math.max(0, current - 1))
              }
            >
              {t('previous', 'Anterior')}
            </Button>
            <span className="text-[13px] text-customColor6">
              {t('page_number', 'Página {{page}}', { page: pageIndex + 1 })}
            </span>
            <Button disabled={!data.continuation} onClick={nextPage}>
              {t('next', 'Próxima')}
            </Button>
          </div>
        </>
      )}

      {selectedDesign && (
        <CanvaImportDialog
          design={selectedDesign}
          close={() => setSelectedDesign(null)}
        />
      )}
    </section>
  );
};
