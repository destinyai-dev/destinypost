'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function CanvaCallbackPage() {
  const fetch = useFetch();
  const router = useRouter();
  const [status, setStatus] = useState('Conectando sua conta do Canva...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error_description') || params.get('error');

    if (oauthError || !code || !state) {
      setStatus(oauthError || 'A autorização do Canva foi cancelada.');
      setFailed(true);
      return;
    }

    fetch('/third-party/canva/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    })
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message || 'Não foi possível concluir a conexão com o Canva'
          );
        }

        setStatus(`Canva conectado como ${data.name}. Redirecionando...`);
        window.setTimeout(() => router.replace('/third-party'), 900);
      })
      .catch((error) => {
        setStatus(error.message);
        setFailed(true);
      });
  }, []);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-[24px]">
      <div className="w-full max-w-[480px] border border-tableBorder rounded-[8px] p-[28px] bg-newBgColorInner text-center">
        <div
          className={`mx-auto mb-[18px] w-[44px] h-[44px] rounded-full flex items-center justify-center text-[22px] ${
            failed
              ? 'bg-red-500/10 text-red-500'
              : 'bg-forth/10 text-forth'
          }`}
        >
          {failed ? '!' : 'C'}
        </div>
        <h1 className="text-[20px] font-[600]">Integração com Canva</h1>
        <p className="text-[14px] text-customColor6 mt-[10px]">{status}</p>
        {failed && (
          <button
            type="button"
            onClick={() => router.replace('/third-party')}
            className="mt-[20px] h-[40px] px-[18px] rounded-[6px] bg-forth text-white"
          >
            Voltar para Integrações
          </button>
        )}
      </div>
    </div>
  );
}
