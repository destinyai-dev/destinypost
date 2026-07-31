'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Media } from '@blueprintjs/icons';
import { SectionTab } from 'polotno/side-panel';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';

type StockPhoto = {
  id: string;
  width: number;
  height: number;
  preview: string;
  source: string;
  alt: string;
  color: string;
  photographer: string;
  photographerUrl: string;
  photoUrl: string;
};

type StockResponse = {
  page: number;
  total: number;
  hasMore: boolean;
  photos: StockPhoto[];
};

const StockPhotosPanel = observer(({ store }: { store: any }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const suggestedQuery = String(store.activePage?.custom?.imageQuery || '');
  const [query, setQuery] = useState(suggestedQuery);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!suggestedQuery || searchedQuery) return;
    setQuery(suggestedQuery);
  }, [searchedQuery, suggestedQuery]);

  const search = useCallback(
    async (nextPage = 1, append = false) => {
      const normalized = query.trim();
      if (normalized.length < 2 || loading) return;
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `/media/stock/search?query=${encodeURIComponent(
            normalized
          )}&page=${nextPage}`
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === 'string'
              ? body.message
              : 'Nao foi possivel buscar as fotos.'
          );
        }
        const result = body as StockResponse;
        setPhotos((current) =>
          append ? [...current, ...(result.photos || [])] : result.photos || []
        );
        setSearchedQuery(normalized);
        setPage(result.page || nextPage);
        setHasMore(Boolean(result.hasMore));
      } catch (err) {
        setError((err as Error).message || 'Falha ao buscar fotos.');
      } finally {
        setLoading(false);
      }
    },
    [fetch, loading, query]
  );

  const usePhoto = useCallback(
    async (photo: StockPhoto) => {
      if (importing) return;
      setImporting(photo.id);
      try {
        const response = await fetch('/media/stock/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: photo.source,
            photographer: photo.photographer,
            photographerUrl: photo.photographerUrl,
            photoUrl: photo.photoUrl,
            alt: photo.alt,
          }),
        });
        const saved = await response.json().catch(() => ({}));
        if (!response.ok || !saved?.path) {
          throw new Error(
            typeof saved?.message === 'string'
              ? saved.message
              : 'Nao foi possivel importar esta foto.'
          );
        }

        const selected = store.selectedElements?.find(
          (element: any) =>
            element?.type === 'image' && element?.contentEditable !== false
        );
        if (selected) {
          selected.set({
            src: saved.path,
            custom: {
              ...(selected.custom || {}),
              stockProvider: 'pexels',
              stockPhotoId: photo.id,
              photographer: photo.photographer,
              photoUrl: photo.photoUrl,
            },
          });
        } else {
          const width = 520;
          const height = 650;
          store.activePage?.addElement({
            type: 'image',
            name: `Foto de ${photo.photographer} no Pexels`,
            src: saved.path,
            x: (store.width - width) / 2,
            y: (store.height - height) / 2,
            width,
            height,
            cropX: 0.5,
            cropY: 0.5,
            keepRatio: false,
            contentEditable: true,
            custom: {
              stockProvider: 'pexels',
              stockPhotoId: photo.id,
              photographer: photo.photographer,
              photoUrl: photo.photoUrl,
            },
          });
        }
        toaster.show('Foto adicionada ao slide.', 'success');
      } catch (err) {
        toaster.show(
          (err as Error).message || 'Falha ao importar a foto.',
          'warning'
        );
      } finally {
        setImporting('');
      }
    },
    [fetch, importing, store, toaster]
  );

  return (
    <div className="h-full flex flex-col text-[#202020]">
      <div className="p-[14px] border-b border-[#dedede]">
        <div className="font-semibold text-[15px]">Banco de imagens</div>
        <div className="text-[12px] text-[#666] mt-[3px]">
          Selecione a imagem do slide antes de substitui-la.
        </div>
        <div className="flex gap-[6px] mt-[12px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') search(1, false);
            }}
            placeholder="Ex.: marketing digital"
            className="min-w-0 flex-1 h-[38px] px-[10px] rounded-[5px] border border-[#c8c8c8] outline-none focus:border-[#246BFD]"
          />
          <button
            type="button"
            onClick={() => search(1, false)}
            disabled={loading || query.trim().length < 2}
            className="h-[38px] px-[12px] rounded-[5px] bg-[#202020] text-white disabled:opacity-45"
          >
            Buscar
          </button>
        </div>
        <a
          href="https://www.pexels.com"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[11px] text-[#4c62d6] mt-[8px] underline"
        >
          Fotos fornecidas por Pexels
        </a>
      </div>

      <div className="flex-1 overflow-y-auto p-[10px]">
        {error ? (
          <div className="rounded-[6px] bg-[#fff4e5] border border-[#f1cc94] p-[12px] text-[12px] leading-[1.45]">
            <div>{error}</div>
            {error.includes('Banco de imagens') ? (
              <a
                href="https://www.pexels.com/api/"
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-[8px] font-semibold underline"
              >
                Criar chave gratuita no Pexels
              </a>
            ) : null}
          </div>
        ) : null}

        {!error && photos.length === 0 ? (
          <div className="text-[12px] text-[#777] text-center px-[15px] py-[35px]">
            {loading
              ? 'Buscando fotos...'
              : 'Pesquise pelo assunto do slide para encontrar uma imagem.'}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-[8px]">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="rounded-[6px] overflow-hidden border border-[#dedede] bg-white"
            >
              <button
                type="button"
                onClick={() => usePhoto(photo)}
                disabled={Boolean(importing)}
                title={`Usar foto de ${photo.photographer}`}
                className="block w-full aspect-[4/5] relative bg-[#eee] disabled:opacity-55"
              >
                <img
                  src={photo.preview}
                  alt={photo.alt}
                  className="absolute inset-0 w-full h-full object-cover"
                  crossOrigin="anonymous"
                />
                {importing === photo.id ? (
                  <span className="absolute inset-0 bg-black/55 text-white flex items-center justify-center text-[11px]">
                    Importando...
                  </span>
                ) : null}
              </button>
              <a
                href={photo.photographerUrl}
                target="_blank"
                rel="noreferrer"
                title={`Foto de ${photo.photographer} no Pexels`}
                className="block truncate px-[7px] py-[6px] text-[10px] text-[#555] underline"
              >
                {photo.photographer}
              </a>
            </div>
          ))}
        </div>

        {hasMore ? (
          <button
            type="button"
            onClick={() => search(page + 1, true)}
            disabled={loading}
            className="w-full h-[38px] mt-[10px] rounded-[5px] border border-[#bdbdbd] disabled:opacity-45"
          >
            {loading ? 'Carregando...' : 'Carregar mais fotos'}
          </button>
        ) : null}
      </div>
    </div>
  );
});

export const StockPhotosSection = {
  name: 'stock-photos',
  Tab: (props: any) => (
    <SectionTab name="Fotos" {...props}>
      <Media />
    </SectionTab>
  ),
  Panel: StockPhotosPanel,
};
