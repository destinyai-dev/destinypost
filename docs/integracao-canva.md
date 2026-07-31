# Integração com o Canva

A integração usa a Canva Connect API para permitir que cada organização conecte a própria conta e importe seus designs para o fluxo de publicação do SaaS.

## Configuração

Defina no servidor:

```env
CANVA_CLIENT_ID=
CANVA_CLIENT_SECRET=
CANVA_REDIRECT_URI=https://seu-dominio.com/api/third-party/canva/oauth/callback
CANVA_SCOPES="profile:read design:meta:read design:content:read"
```

O mesmo URI de redirecionamento deve ser cadastrado na integração do Canva Developers. Para atender clientes externos, a integração pública precisa passar pela revisão do Canva.

## Fluxo do cliente

1. O cliente abre **Integrações**, escolhe Canva e autoriza a própria conta.
2. O sistema salva os tokens criptografados e vinculados à organização.
3. A galeria lista designs próprios e compartilhados, com busca, atualização e paginação.
4. **Editar no Canva** abre o editor oficial do design.
5. **Importar para publicação** exporta cada página como PNG e salva os arquivos na biblioteca de mídia do perfil ativo.
6. O sistema cria um rascunho no canal escolhido, mantendo a ordem das páginas e deixando legenda, data e demais opções prontas para edição.
7. **Desconectar Canva** revoga o token e remove a conexão. As mídias e os rascunhos já importados são preservados.

## Endpoints

- `GET /third-party/canva/oauth/start`
- `POST /third-party/canva/oauth/exchange`
- `GET /third-party/canva/designs`
- `POST /third-party/canva/designs/:designId/import`
- `DELETE /third-party/canva`

O Canva não entrega o design como um projeto editável do Polotno. A importação traz cada página renderizada como imagem; alterações estruturais continuam sendo feitas pelo botão **Editar no Canva**.
