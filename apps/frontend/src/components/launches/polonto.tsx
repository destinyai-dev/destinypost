'use client';

import {
  createContext,
  FC,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import 'polotno/polotno.blueprint.css';
import { createStore } from 'polotno/model/store';
import Workspace from 'polotno/canvas/workspace';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import Toolbar from 'polotno/toolbar/toolbar';
import ZoomButtons from 'polotno/toolbar/zoom-buttons';
import { PagesTimeline } from 'polotno/pages-timeline';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { PictureGeneratorSection } from '@gitroom/frontend/components/launches/polonto/polonto.picture.generation';
import { StockPhotosSection } from '@gitroom/frontend/components/launches/polonto/polonto.stock.photos';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { loadVars } from '@gitroom/react/helpers/variable.context';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useToaster } from '@gitroom/react/toaster/toaster';

export type PolotnoSavedMedia = { id: string; path: string };

export type PolotnoProjectResult = {
  media: PolotnoSavedMedia[];
  design: Record<string, unknown>;
  designPath?: string;
};

type CloseContextValue = {
  close: () => void;
  setMedia: (media: PolotnoSavedMedia[]) => void;
  onSaveProject?: (project: PolotnoProjectResult) => void;
  carousel: boolean;
};

const CloseContext = createContext<CloseContextValue>({
  close: () => undefined,
  setMedia: () => undefined,
  carousel: false,
});

const uploadBlob = async (
  fetch: ReturnType<typeof useFetch>,
  blob: Blob,
  fileName: string
) => {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  const response = await fetch('/media/upload-simple', {
    method: 'POST',
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.path) {
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : 'Nao foi possivel salvar o arquivo.'
    );
  }
  return body;
};

const uploadProject = async (
  fetch: ReturnType<typeof useFetch>,
  design: Record<string, unknown>
) => {
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([JSON.stringify(design)], { type: 'application/json' }),
    'carrossel-editavel.json'
  );
  const response = await fetch('/media/upload-polotno-project', {
    method: 'POST',
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.path) {
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : 'Nao foi possivel salvar o projeto editavel.'
    );
  }
  return body as { path: string };
};

const waitForCanvas = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const ActionControls = ({ store }: { store: any }) => {
  const t = useT();
  const context = useContext(CloseContext);
  const [load, setLoad] = useState(false);
  const [progress, setProgress] = useState('');
  const fetch = useFetch();
  const toaster = useToaster();

  return (
    <div className="flex items-center gap-[8px]">
      <div className="hidden md:block text-[12px] text-[#666]">
        {context.carousel
          ? `${store.pages?.length || 0} slides editaveis`
          : 'Projeto editavel'}
      </div>
      <Button
        loading={load}
        className="outline-none"
        innerClassName="invert outline-none text-black"
        onClick={async () => {
          if (load) return;
          setLoad(true);
          try {
            await store.waitLoading();
            const media: PolotnoSavedMedia[] = [];
            const pages = context.carousel
              ? Array.from(store.pages || [])
              : [store.activePage || store.pages?.[0]];

            for (let index = 0; index < pages.length; index += 1) {
              const page = pages[index] as { id: string };
              if (!page?.id) continue;
              if (context.carousel) {
                setProgress(`Exportando slide ${index + 1} de ${pages.length}`);
                if (typeof store.selectPage === 'function') {
                  store.selectPage(page.id);
                  await waitForCanvas();
                }
              }
              await store.waitLoading();
              const blob = context.carousel
                ? await store.toBlob({
                    pageId: page.id,
                    pixelRatio: 1,
                    mimeType: 'image/png',
                  })
                : await store.toBlob();
              if (!(blob instanceof Blob) || blob.size === 0) {
                throw new Error(`O slide ${index + 1} nao pode ser exportado.`);
              }
              setProgress(
                context.carousel
                  ? `Salvando slide ${index + 1} de ${pages.length}`
                  : 'Salvando midia'
              );
              const saved = await uploadBlob(
                fetch,
                blob,
                context.carousel
                  ? `carrossel-slide-${String(index + 1).padStart(2, '0')}.png`
                  : 'media.png'
              );
              media.push({ id: saved.id, path: saved.path });
            }

            if (!media.length) {
              throw new Error('O projeto nao possui paginas para exportar.');
            }

            const design = store.toJSON() as Record<string, unknown>;
            let designPath: string | undefined;
            if (context.carousel) {
              setProgress('Salvando projeto editavel');
              try {
                const savedDesign = await uploadProject(fetch, design);
                designPath = savedDesign.path;
              } catch (error) {
                console.error('Falha ao salvar projeto Polotno:', error);
              }
            }

            context.setMedia(media);
            context.onSaveProject?.({ media, design, designPath });
            toaster.show(
              context.carousel
                ? `${media.length} slides salvos na biblioteca de midia.`
                : t('media_saved', 'Midia salva.'),
              'success'
            );
            context.close();
          } catch (error) {
            toaster.show(
              (error as Error).message || 'Nao foi possivel exportar o projeto.',
              'warning'
            );
          } finally {
            setLoad(false);
            setProgress('');
          }
        }}
      >
        {progress || (context.carousel
          ? 'Salvar todos os slides'
          : t('use_this_media', 'Use this media'))}
      </Button>
    </div>
  );
};

const Polonto: FC<{
  setMedia: (params: PolotnoSavedMedia[]) => void;
  type?: 'image' | 'video';
  closeModal: () => void;
  width?: number;
  height?: number;
  initialDesign?: Record<string, unknown>;
  carousel?: boolean;
  onSaveProject?: (project: PolotnoProjectResult) => void;
}> = (props) => {
  const {
    setMedia,
    closeModal,
    initialDesign,
    carousel = false,
    onSaveProject,
  } = props;
  const fetch = useFetch();
  const { data: polotnoLicense } = useSWR(
    'polotno-license-key',
    async () => {
      const response = await fetch('/credentials/polotno-key');
      return response.ok
        ? ((await response.json()) as { key?: string })
        : { key: '' };
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
  const polotnoKey =
    polotnoLicense?.key || loadVars().plontoKey || '';
  const store = useMemo(
    () =>
      createStore({
        get key() {
          return polotnoKey;
        },
        showCredit: false,
      }),
    [polotnoKey]
  );

  const setActivateExitButton = useLaunchStore((e) => e.setActivateExitButton);
  useEffect(() => {
    setActivateExitButton(false);
    return () => setActivateExitButton(true);
  }, [setActivateExitButton]);

  const user = useUser();
  const features = useMemo(
    () => [
      StockPhotosSection,
      ...DEFAULT_SECTIONS.filter(
        (section: { name?: string }) => section.name !== 'photos'
      ),
      ...(user?.tier?.image_generator ? [PictureGeneratorSection] : []),
    ] as any[],
    [user?.tier?.image_generator]
  );

  useEffect(() => {
    if (initialDesign && Array.isArray((initialDesign as any).pages)) {
      store.loadJSON(initialDesign as any);
    } else {
      store.addPage({
        width: props.width || 540,
        height: props.height || 675,
      });
    }
    return () => store.clear();
  }, [initialDesign, props.height, props.width, store]);

  return (
    <div className="bg-white text-black relative z-[400] polonto h-full min-h-[620px]">
      <CloseContext.Provider
        value={{
          close: closeModal,
          setMedia,
          onSaveProject,
          carousel,
        }}
      >
        <PolotnoContainer
          style={{
            width: '100%',
            height: carousel ? 'calc(100vh - 180px)' : '700px',
            minHeight: '600px',
          }}
        >
          <SidePanelWrap>
            <SidePanel
              store={store}
              sections={features}
              defaultSection={carousel ? 'stock-photos' : undefined}
            />
          </SidePanelWrap>
          <WorkspaceWrap>
            <Toolbar
              store={store}
              components={{
                ActionControls,
              }}
            />
            <Workspace store={store} />
            <ZoomButtons store={store} />
            {carousel ? <PagesTimeline store={store} /> : null}
          </WorkspaceWrap>
        </PolotnoContainer>
      </CloseContext.Provider>
    </div>
  );
};

export default Polonto;
