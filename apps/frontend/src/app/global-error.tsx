'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  useEffect(() => {
    if (!sentryDsn) {
      return;
    }
    const eventId = Sentry.captureException(error);
    Sentry.showReportDialog({
      eventId,
      title: 'Something broke!',
      subtitle: 'Please help us fix the issue by providing some details.',
      labelComments: 'What happened?',
      labelName: 'Your name',
      labelEmail: 'Your email',
      labelSubmit: 'Send Report',
      lang: 'en',
    });

  }, [error, sentryDsn]);
  return (
    <html lang="pt-BR">
      <body
        style={{
          alignItems: 'center',
          background: '#0f0f10',
          color: '#ffffff',
          display: 'flex',
          fontFamily: 'Arial, sans-serif',
          justifyContent: 'center',
          margin: 0,
          minHeight: '100vh',
          padding: '24px',
        }}
      >
        <main style={{ maxWidth: '520px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', marginBottom: '12px' }}>
            Algo nao saiu como esperado
          </h1>
          <p style={{ color: '#b8b8bd', lineHeight: 1.6 }}>
            Atualize a pagina para tentar novamente. Se o problema continuar,
            consulte os logs da instalacao.
          </p>
        </main>
      </body>
    </html>
  );
}
