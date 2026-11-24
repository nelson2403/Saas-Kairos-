# PROJECT_STATUS — SAS Kairós

Estados: **Não iniciado · Em desenvolvimento · Implementado · Testado · Concluído · Bloqueado**
Uma fase só é **Concluída** quando o critério de aceite é atendido no ambiente de teste.

Última atualização: 24/11/2026

## Resumo

| Fase | Status | Observação |
|---|---|---|
| 0 — Auditoria e planejamento | Concluído | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 1 — Fundação + PWA | **Bloqueado** (código testado) | Falta: projeto Supabase, deploy na Vercel e teste de instalação em aparelhos reais |
| 2 — Produtos e estoque | Não iniciado | Aguarda aceite da Fase 1 |
| 3 — Produção | Não iniciado | |
| 4 — Clientes, fornecedores e compras | Não iniciado | |
| 5 — Vendas e financeiro | Não iniciado | |
| 6 — Loja virtual | Não iniciado | |
| 7 — Personalização da loja | Não iniciado | |
| 8 — Asaas | Não iniciado | Depende de conta Asaas (sandbox) |
| 9 — WhatsApp / Evolution API | Não iniciado | Depende de servidor Evolution API |
| 10 — PWA avançada e finalização | Não iniciado | |

## Dependências externas em aberto

| Dependência | Bloqueia | Responsável |
|---|---|---|
| Logo oficial (SVG ou PNG ≥ 1024 px, fundo transparente) | Ícones e assinatura definitivos (hoje provisórios) | Kairós |
| Projeto Supabase (URL, publishable key, secret key) + migrations aplicadas | Login real, critério da Fase 1 | Kairós / dev |
| Projeto Vercel ligado ao GitHub + variáveis de ambiente | Ambiente de teste publicado | Kairós / dev |
| Push do código para `github.com/nelson2403/Saas-Kairos-` | Deploy | aguardando autorização |
| Aparelho Android e iPhone para teste de instalação | Critério da Fase 1 | Kairós |

## Fase 1 — Fundação + PWA

Critério: *aplicação publicada em ambiente de teste, com login funcional, banco conectado e instalação PWA testada nos dispositivos compatíveis.*

| Funcionalidade | Status | Arquivos | Testes | Pendências |
|---|---|---|---|---|
| Next.js 16.4 + TypeScript strict + Tailwind 4 | Testado | `package.json`, `next.config.ts`, `tsconfig.json` | build de produção e lint sem erros | — |
| Identidade Kairós (Paleta Mineral, tipografia) | Implementado | `src/app/globals.css`, `src/components/brand/logo.tsx` | inspeção visual (login, offline, home) | logo oficial |
| Migration de fundação (empresas, perfis, papéis, membros, auditoria, idempotência, push, integrações) | Testado | `supabase/migrations/20261124000100_foundation.sql` | 15 testes em Postgres real (PGlite) | aplicar no Supabase |
| RLS multi-tenant por `company_id` | Testado | mesma migration | isolamento entre empresas, papéis, anônimo, segredos inacessíveis | — |
| Credenciais de integrações isoladas (`integration_secrets` sem acesso pela API) | Testado | mesma migration | teste de permissão | criptografia AES-GCM entra na Fase 8 |
| Autenticação (login, logout, sessão, proteção de rotas) | Implementado | `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/auth/dal.ts`, `src/app/login/*` | redirecionamento de `/admin` sem sessão verificado por HTTP | **teste de login real exige Supabase**; recuperação de senha (Fase 10 ou antes, se pedido) |
| Onboarding da empresa (primeiro acesso → proprietário) | Implementado | `src/app/onboarding/*`, `src/modules/company/*` | função SQL testada | teste ponta a ponta exige Supabase |
| Configurações → Empresa (edição persistida, validação de CPF/CNPJ) | Implementado | `src/app/admin/configuracoes/*` | 3 testes de validação de documento | teste ponta a ponta exige Supabase |
| Layout do painel: menu lateral, barra superior, navegação inferior (Início, Estoque, Produção, Pedidos, Mais) | Implementado | `src/app/admin/layout.tsx`, `src/components/layout/*`, `src/config/modules.ts` | build | inspeção visual exige login |
| Páginas de status de módulos futuros (sem telas falsas) | Implementado | `src/app/admin/[modulo]/page.tsx` | build (15 rotas pré-renderizadas) | — |
| Manifest (nome, ícones, standalone, atalhos) | Testado | `src/app/manifest.ts` | servido em `/manifest.webmanifest` | — |
| Ícones (192, 512, maskable, Apple, favicon, badge) | Implementado | `public/icons/*`, `scripts/generate-icons.mjs` | gerados e conferidos | provisórios até a logo |
| Service Worker (cache de assets, fallback offline, atualização controlada, limpeza no logout, push) | Testado | `public/sw.js`, `src/components/pwa/service-worker.tsx` | Edge real: registro, controle da página, conteúdo dos caches, fallback offline | — |
| Instalação (Android via `beforeinstallprompt`, instruções iOS) | Implementado | `src/components/pwa/install-prompt.tsx` | — | **teste em aparelhos reais** |
| Status de conexão (Online/Offline/Sincronizando/Sincronizado/Falha) + tela Status do app | Implementado | `src/hooks/use-connection-status.ts`, `src/components/pwa/connection-status.tsx`, `src/app/admin/status/*` | — | — |
| Fila offline (IndexedDB) + motor de sincronização idempotente | Testado | `src/lib/offline/*` | 7 testes (ordem, reenvio com mesmo id, conflito, limite de tentativas, concorrência, isolamento por usuário) | endpoint `/api/sync` entra com a 1ª operação real (Fase 2) |
| Cabeçalhos de segurança | Testado | `next.config.ts` | conferidos por HTTP | CSP completa na Fase 10 |
| SEO básico (robots, metadados) | Implementado | `src/app/robots.ts`, `src/app/layout.tsx` | — | sitemap e dados estruturados na Fase 6 |
| `.env.example`, README | Concluído | | | |

### Como concluir a Fase 1

1. Criar o projeto Supabase e aplicar a migration (README → "Configurando o Supabase").
2. Autorizar o push para o GitHub e importar na Vercel com as variáveis.
3. Validar no preview: login, criação da empresa, edição em Configurações, Status do app mostrando "Banco de dados: Conectado".
4. Instalar no Android (Chrome) e no iPhone (Safari) e abrir em modo aplicativo.

## Decisões registradas

- **Service Worker próprio** em vez de plugin (ver ARCHITECTURE §3).
- **Regras críticas no Postgres** em funções transacionais; tabelas de movimentação sem escrita direta pela API.
- **Rotas do painel em `/admin`** e loja na raiz; PWA com `start_url=/admin`.
- **Cores de texto derivadas** ("tinta") adicionadas à paleta por acessibilidade — a paleta oficial não foi alterada.
- **Um usuário ↔ uma empresa** na versão 1 (multi-empresa por usuário fica para a fase SaaS).
