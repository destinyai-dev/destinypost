<p align="center">
  <img alt="DestinyPost" src="apps/frontend/public/destinypost-logo.png" width="420" />
</p>

<h1 align="center">DestinyPost</h1>
<p align="center">Plataforma self-hosted para planejar, criar, automatizar e publicar conteúdo em redes sociais.</p>

<p align="center">
  <a href="https://opensource.org/license/agpl-v3">
    <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="Licença AGPL-3.0" />
  </a>
  <a href="https://github.com/destinyai-dev/destinypost">
    <img src="https://img.shields.io/badge/GitHub-destinyai--dev%2Fdestinypost-78c53a.svg" alt="Repositório DestinyPost" />
  </a>
</p>

## Sobre o DestinyPost

O **DestinyPost** reúne agendamento, publicação, biblioteca de mídia, agentes de IA, criação de carrosséis, automações e integrações em uma única instalação. Cada cliente pode executar sua própria instância em uma VPS e cadastrar as próprias credenciais de redes sociais e APIs pela interface.

Principais recursos:

- calendário e agendamento para múltiplas redes sociais;
- publicação imediata ou programada;
- agentes de IA com memória por conversa e perfil;
- mapeamento de perfis do Instagram e estratégia de conteúdo;
- criação e edição de carrosséis;
- biblioteca de mídia e integração com Canva;
- automações para comentários e mensagens do Instagram;
- organizações, perfis, equipes e permissões isoladas;
- API pública, MCP e webhooks para integrações como n8n;
- instalação privada com Docker, HTTPS automático e comandos de manutenção.

## Redes sociais

Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Pinterest, Threads, Reddit, Discord, Slack, Mastodon, Bluesky, Dribbble e outros canais compatíveis com a plataforma.

## Requisitos da VPS

| Recurso | Mínimo | Recomendado |
|---|---:|---:|
| Memória RAM | 4 GB | 8 GB |
| Armazenamento livre | 35 GB | 80 GB ou mais |
| Sistema operacional | Ubuntu 22.04/24.04 ou Debian 12 | Ubuntu LTS |
| Domínio | Registro A apontado para a VPS | Obrigatório para HTTPS |
| Portas liberadas | 22, 80 e 443 | 22 restrita ao IP do administrador |

## Instalação para clientes

A distribuição oficial é privada. O cliente recebe um token de leitura e o instalador da release autorizada. O processo instala Docker, banco de dados, Redis, Temporal, Elasticsearch, Caddy e o aplicativo DestinyPost.

```bash
chmod +x install.sh
sudo bash install.sh
```

Durante a instalação serão solicitados:

1. domínio já apontado para o IPv4 da VPS;
2. e-mail para o certificado HTTPS;
3. token de leitura da distribuição DestinyPost.

Ao concluir, abra o domínio e crie a primeira conta. Essa conta será a administradora e o cadastro público será bloqueado depois dela.

## Manutenção

O instalador adiciona o comando `destinypost` à VPS:

```bash
destinypost status
destinypost logs
destinypost doctor
destinypost backup
destinypost update
```

Os dados persistentes ficam fora do container em volumes Docker. Uma atualização troca a imagem da aplicação sem apagar banco de dados, uploads ou configurações.

## Desenvolvimento

O projeto usa pnpm workspaces, Next.js, React, NestJS, PostgreSQL/Prisma, Redis, Temporal e Docker.

```bash
pnpm install
pnpm run dev
```

Documentos importantes:

- [Instalação self-hosted](deployment/self-hosted/README.md)
- [API pública](docs/api/public-api.md)
- [Automações do Instagram](docs/automacoes-instagram.md)
- [Arquitetura multi-tenant](docs/architecture/multi-tenancy.md)

## Autoria e manutenção

O **DestinyPost** é desenvolvido e mantido pela **Destiny AI**, por meio da organização [destinyai-dev](https://github.com/destinyai-dev).

## Créditos do projeto original

O DestinyPost é baseado no [Postiz](https://github.com/gitroomhq/postiz-app), desenvolvido pela equipe GitRoom HQ e licenciado sob a AGPL-3.0. Os avisos de copyright, o histórico aplicável e os termos da licença do projeto original são preservados.

As modificações do DestinyPost também são distribuídas sob a [AGPL-3.0](LICENSE).
