'use client';

export default function GlobalError() {
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
