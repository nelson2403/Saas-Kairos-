# SAS KAIRÓS — Arquitetura (Fase 0)

> "ONDE O AGORA SE TORNA ABRIGO"

Documento vivo. Registra o estado auditado do repositório, as decisões de arquitetura e o plano de fases. Toda decisão que mudar a arquitetura deve ser registrada aqui antes de ser implementada.

---

## 1. Estado atual (auditoria de 24/11/2026)

| Item | Situação |
|---|---|
| Repositório GitHub `nelson2403/Saas-Kairos-` | Vazio (nenhum commit) |
| Pasta local | Vazia antes desta fase |
| Logo / materiais da marca | **Não fornecidos.** Nenhum arquivo de logo no repositório |
| Projeto Supabase | **Não informado** (sem URL/chaves) |
| Projeto Vercel | **Não informado** |
| Ferramentas na máquina | Node 24.15, npm 11.12, Git 2.54. Sem Docker, sem `psql`, sem Supabase CLI, sem Vercel CLI, sem `gh` |

Conclusão: projeto greenfield. Nada a preservar ou migrar.

**Dependências externas que bloqueiam critérios de aceite (não o desenvolvimento):**

1. Arquivo da logo original (SVG de preferência, ou PNG ≥ 1024 px com fundo transparente). Até lá, usa-se um **monograma tipográfico provisório** (“K” em Marfim/Cinza Mineral) nos ícones do PWA e o nome "KAIRÓS" em texto. Isso fica explícito no `PROJECT_STATUS.md`.
2. Projeto Supabase (URL, publishable key, secret key) para aplicar migrations e testar login real.
3. Conta Vercel conectada ao repositório para o ambiente de teste (preview).

---

## 2. Arquitetura recomendada

**Monólito modular** em Next.js (App Router) + Supabase. Um único deploy atende painel, loja e APIs; o banco é a fonte única da verdade e as regras críticas (estoque, produção, reservas, pagamentos) rodam **dentro do PostgreSQL em funções transacionais**, chamadas pelo servidor Next.js. Assim a integridade não depende do front-end nem de qual cliente (painel, loja, PWA offline, webhook) originou a operação.

```
 Navegador / PWA ──► Next.js (Vercel)
   │  Service Worker     ├─ Server Components (leitura, RLS do usuário)
   │  IndexedDB (fila)   ├─ Server Actions (mutações validadas com Zod)
   │                     ├─ Route Handlers /api (sync offline, webhooks, integrações)
   │                     └─ proxy.ts (renova sessão, protege /admin)
   │                              │
   │                              ▼
   │                     Supabase
   │                       ├─ Auth (sessão em cookie httpOnly)
   │                       ├─ PostgreSQL + RLS por company_id
   │                       │    └─ funções fn_* transacionais (estoque, produção, pedidos)
   │                       ├─ Storage (imagens de produtos, banners, logo)
   │                       └─ pg_cron / Edge Functions (expirar reservas, filas)
   │
   └── Integrações externas (somente pelo servidor): Asaas, Evolution API
```

### Camadas no código

| Camada | Onde | Responsabilidade |
|---|---|---|
| Interface | `src/app`, `src/components` | Renderização e interação. Sem regra de negócio |
| Ações / rotas | `src/app/**/actions.ts`, `src/app/api` | Autenticação, autorização, validação (Zod), chamada do serviço |
| Serviços | `src/modules/<módulo>/service.ts` | Orquestram regras de negócio |
| Repositórios | `src/modules/<módulo>/repository.ts` | Único ponto que fala com o Supabase |
| Regras de domínio puras | `src/modules/<módulo>/domain.ts` | Cálculos testáveis (conversão de unidades, custo de ficha técnica, margens) |
| Validações | `src/lib/validations`, `src/modules/<módulo>/schemas.ts` | Esquemas Zod compartilhados entre cliente e servidor |
| Integrações | `src/lib/integrations/{asaas,whatsapp}` | Clientes HTTP, criptografia de credenciais, verificação de webhooks |
| Persistência | `supabase/migrations` | Tabelas, RLS, funções transacionais |

---

## 3. Tecnologias

| Tecnologia | Versão | Observação |
|---|---|---|
| Next.js (App Router) | 16.4 | `proxy.ts` (substitui `middleware`), Cache Components, Partial Prefetching, `useOffline` experimental |
| React | 19.3 | |
| TypeScript | 5 | modo `strict` |
| Tailwind CSS | 4.3 | tokens via `@theme` + variáveis CSS (base para o editor de loja) |
| Componentes | shadcn/ui (padrão de código: Radix + CVA + tailwind-merge) | componentes ficam no repositório em `src/components/ui` |
| Ícones | lucide-react | |
| Supabase | `@supabase/ssr` 0.12, `supabase-js` 2.119 | sessão em cookies; `getClaims()` para validar JWT |
| Validação | Zod 4 + React Hook Form | |
| IndexedDB | `idb` | fila offline e cache de leitura |
| Testes | Vitest + PGlite (Postgres em WASM) | migrations e RLS são testados de verdade em Postgres, sem Docker |
| A adicionar por fase | TanStack Query, Recharts, dnd-kit, leitor de código de barras (BarcodeDetector + fallback ZXing), exportação PDF/XLSX | |

**Decisão: Service Worker escrito à mão** (`public/sw.js`) em vez de plugin (Serwist/next-pwa). Motivo: o Next 16 usa Turbopack por padrão e os plugins PWA dependem de integração com o bundler; um SW próprio, pequeno e versionado, dá controle total sobre o que é (e o que **não** é) armazenado em cache — importante porque o painel mostra dados financeiros e pessoais. Revisitar na Fase 10 se o precache de assets precisar de manifesto gerado no build.

---

## 4. Estrutura de pastas

```
src/
  app/
    (store)/            loja pública: /, /produtos, /p/[slug], /carrinho, /checkout
    admin/              painel privado (/admin/...)
      (shell)/          layout com sidebar + navegação inferior
    login/              autenticação
    offline/            página de fallback do Service Worker
    api/
      sync/             recebe operações da fila offline (idempotente)
      webhooks/asaas/   webhook Asaas
      webhooks/whatsapp/webhook Evolution API
      integrations/     rotas de servidor que chamam Asaas/Evolution
    manifest.ts         Web App Manifest
  components/
    ui/                 primitivos (shadcn)
    brand/              logo, monograma
    pwa/                registro do SW, instalação, status de conexão
    layout/             sidebar, bottom nav, topbar
    dashboard/ inventory/ production/ storefront/ integrations/
  modules/              domínio por módulo (service, repository, domain, schemas)
    products/ raw-materials/ inventory/ production/ customers/ suppliers/
    purchases/ sales/ finance/ storefront/ integrations/
  lib/
    supabase/           clientes browser/servidor/proxy/admin
    auth/               DAL: getCurrentUser, requireMembership, requireRole
    offline/            fila IndexedDB e motor de sincronização
    integrations/       asaas/, whatsapp/, crypto.ts
    validations/ utils/
  hooks/
  types/                database.ts (gerado pelo Supabase CLI)
supabase/
  migrations/           SQL versionado (uma migration por fase/assunto)
  functions/            Edge Functions (filas, cron)
  seed.sql              unidades de medida e papéis do sistema
public/
  brand/ icons/ banners/ sw.js
tests/
  db/                   migrations + RLS em PGlite
  unit/                 regras de domínio
```

---

## 5. Modelo do banco

Convenções obrigatórias:

- PK `id uuid default gen_random_uuid()`.
- **Toda tabela de negócio tem `company_id uuid not null`** → `companies(id)` e política RLS por membro.
- Dinheiro: `numeric(14,2)`. Quantidades: `numeric(18,6)`. Custos unitários: `numeric(18,6)`. **Nunca `float`.**
- `created_at`, `updated_at` (trigger), `created_by` quando fizer sentido.
- Exclusão: cadastros usam `status`/`archived_at` (desativar); movimentações e eventos financeiros **nunca** são apagados — são estornados por um novo registro.
- Itens de estoque são "produto **ou** matéria-prima": colunas `product_id` e `raw_material_id` anuláveis com `CHECK` garantindo exatamente uma (FK real, sem polimorfismo solto).

### Grupos e relacionamentos principais

**Empresa e acesso** (Fase 1)
- Instalação de **empresa única** (`private.app_config.single_company = true`): a função de criação recusa uma segunda empresa; a estrutura multi-tenant permanece para uma futura versão SaaS.
- `companies` — dados da empresa, fuso, moeda, configurações gerais (`settings jsonb`).
- `profiles` (1:1 `auth.users`) — nome, telefone, avatar.
- `roles` — papéis do sistema (`owner`, `admin`, `manager`, `operator`, `viewer`) com `permissions jsonb`; `company_id` nulo = papel global.
- `company_members` — (`company_id`, `user_id`, `role_id`, `status`). Base de toda RLS.
- `audit_logs` — quem, quando, tabela, registro, ação, diff (sem segredos).
- `client_operations` — idempotência da fila offline: `unique(company_id, client_op_id)`.
- `push_subscriptions` — endpoints Web Push por usuário/dispositivo.
- `integrations`, `integration_secrets`, `webhook_events` — esqueleto criado na fundação (ver §9 e §10).

**Produtos e matérias-primas** (Fase 2)
- `product_categories` (árvore via `parent_id`), `products` (SKU e código de barras únicos por empresa), `product_images` (Storage).
- `measurement_units` (globais + personalizadas por empresa; `dimension`: massa, volume, comprimento, unidade; `factor_to_base`). Conversão massa↔volume só via `density` cadastrada no material.
- `raw_materials` → `measurement_units`, `suppliers` (fornecedor preferencial).

**Estoque** (Fase 2)
- `stock_balances` — saldo por item (`quantity`, `reserved_quantity`, `CHECK quantity >= 0` salvo se a empresa permitir negativo).
- `stock_movements` — imutável. Tipo (`entrada`, `saida`, `compra`, `producao_consumo`, `producao_entrada`, `venda`, `ajuste`, `perda`, `descarte`, `devolucao`, `transferencia`, `estorno`), quantidade, saldo anterior/posterior, custo unitário, responsável, motivo, documento (`source_type` + `source_id`), `reversal_of`.
- `inventory_counts` (+ itens) — inventário que gera ajustes.
- `stock_reservations` — pedido, item, quantidade, `expires_at`, status (`ativa`, `consumida`, `liberada`, `expirada`). **Criada na Fase 5** junto com pedidos (a coluna `reserved_quantity` já existe no saldo).
- Implementado na Fase 2: `fn_register_stock_movement`, `fn_reverse_stock_movement`, `fn_create_inventory_count`, `fn_apply_inventory_count`, `fn_cancel_inventory_count`, visão `stock_overview` (`security_invoker`). `transferencia` ficou fora até existir cadastro de locais de estoque.

**Produção** (Fase 3)
- `product_recipes` (versão ativa por produto, rendimento, % perda) → `recipe_items` (matéria-prima, quantidade, unidade).
- `production_orders` (status, quantidade, custo calculado, `reversal_of`) → `production_items` (consumo real por material).
- Implementado na Fase 3: `product_recipes` versionada (`version`, `is_active`, imutável) → `recipe_items`; `production_orders` (`number` sequencial via `document_sequences`, `planned/produced_quantity`, `material_cost`, `unit_cost`, `cost_complete`, status `planned/completed/canceled/reversed`) → `production_order_items` (planejado × real, custo). Funções `fn_save_recipe`, `fn_deactivate_recipe`, `fn_create_production_order`, `fn_complete_production_order`, `fn_cancel_production_order`, `fn_reverse_production_order`. O estorno é registrado nas próprias movimentações (`reversal_of`), não na ordem.

**Compras** (Fase 4)
- `suppliers`, `purchase_orders` → `purchase_items`. Só `fn_receive_purchase` gera entrada de estoque.
- Implementado na Fase 4: `suppliers`, `raw_materials.preferred_supplier_id`, `purchase_orders` (`number`, status `draft/ordered/partial/received/closed/canceled`) → `purchase_order_items` (unidade e preço de compra, `received_quantity`), `purchase_receipts` → `purchase_receipt_items` (`movement_id`). Funções `fn_save_purchase_order`, `fn_set_purchase_order_status`, `fn_receive_purchase`, `fn_reverse_purchase_receipt`. Clientes: `customers`, `customer_consents` (imutável), `fn_anonymize_customer`, `fn_log_customer_export`, auditoria mascarada (`private.audit_row_masked`).

**Comercial** (Fases 4–6)
- `customers` (consentimentos LGPD: `marketing_opt_in`, `whatsapp_opt_in`, datas).
- `orders` (loja e venda manual; `channel`, `number` sequencial por empresa, `idempotency_key` único) → `order_items`; `order_status_history`.
- `sales` / `sale_items` — venda efetivada (registro fiscal/gerencial gerado a partir do pedido pago; evita contar pedido não pago como venda).
- `coupons`.

**Financeiro** (Fase 5)
- `payments` — cobranças (Asaas ou manual): valor, método, status, `external_id` único.
- `financial_transactions` — contas a pagar/receber com competência, vencimento, data de liquidação, valor previsto × liquidado. Fluxo de caixa = transações liquidadas; faturamento = vendas. São visões diferentes por construção.
- `expenses` — despesas categorizadas (geram `financial_transactions`).

**Loja** (Fases 6–7)
- `storefront_settings` (domínio, SEO, contatos), `storefront_theme` (tokens de cor/tipografia/aparência em `jsonb`), `storefront_sections` (tipo, ordem, visível, config), `storefront_banners` (agenda `starts_at`/`ends_at`), `storefront_versions` (snapshot `jsonb` do rascunho publicado; restauração = copiar snapshot para rascunho), `product_reviews` (aprovada, destacada, `verified_purchase`).
- Rascunho e publicado ficam separados: a loja pública lê **somente** a versão publicada.

**Integrações** (fundação + Fases 8–9)
- `integrations` (provedor, ambiente, status, metadados não sensíveis), `integration_secrets` (credenciais **criptografadas**, sem política RLS → inacessível a clientes), `integration_instances` (instâncias Evolution), `webhook_events` (`unique(provider, event_id)`), `notification_templates`, `notification_rules`, `message_queue` (`unique(dedupe_key)`), `notification_logs`.

---

## 6. Segurança

- **RLS em todas as tabelas.** Funções auxiliares `SECURITY DEFINER` com `search_path` fixo: `is_company_member(company_id)`, `has_company_role(company_id, roles[])`.
- **Escrita crítica só por funções** (`fn_register_stock_movement`, `fn_confirm_production`, `fn_reserve_stock`, `fn_confirm_order_payment`…): tabelas de movimentação não têm política de INSERT/UPDATE/DELETE para `authenticated`; as funções verificam papel, travam linhas (`SELECT … FOR UPDATE`) e gravam tudo ou nada.
- **Chave secreta do Supabase** (`SUPABASE_SECRET_KEY`) só no servidor, em `src/lib/supabase/admin.ts` com `import 'server-only'` — o build falha se um componente cliente importar.
- **Credenciais de integrações**: criptografia AES-256-GCM no servidor com `INTEGRATIONS_ENCRYPTION_KEY` (env da Vercel). Banco guarda apenas `iv + ciphertext + tag`. A UI só vê "configurado em dd/mm" e os 4 últimos caracteres.
- **Webhooks**: Asaas validado pelo header `asaas-access-token` (comparação em tempo constante) + idempotência por `event_id`; Evolution por segredo na URL/header + conferência da instância. Eventos são registrados antes de processados.
- **Sessão**: cookies httpOnly do Supabase, renovados no `proxy.ts`; páginas validam com `getClaims()` (não confiam em `getSession()`); Server Actions revalidam usuário e papel.
- **Cabeçalhos**: `X-Content-Type-Options`, `X-Frame-Options: DENY` (exceto rota de pré-visualização da loja, que usa `frame-ancestors 'self'`), `Referrer-Policy`, `Permissions-Policy` (câmera apenas `self`, para fotos/código de barras).
- **Rate limiting**: login, checkout, webhooks e APIs públicas (tabela de janelas no Postgres na Fase 6; trocar por Upstash/Vercel KV se o volume exigir).
- **Logs**: nunca registrar tokens, chaves, CPF completo ou payload de cartão. `audit_logs` guarda diffs de campos de negócio.
- **LGPD**: consentimento explícito para marketing/WhatsApp, registro da base legal, exportação e anonimização de cliente sob solicitação (Fase 4).

---

## 7. Arquitetura PWA

| Peça | Implementação |
|---|---|
| Manifest | `src/app/manifest.ts` — nome "SAS Kairós", curto "Kairós", `display: standalone`, `start_url: /admin`, cores da Paleta Mineral, ícones 192/512 + `maskable` |
| Ícones / splash | `public/icons/*` gerados por `scripts/generate-icons.mjs` (sharp) a partir de um SVG. iOS: `apple-touch-icon` + `appleWebApp` nos metadados |
| Service Worker | `public/sw.js` versionado. Estratégias: assets `/_next/static` → cache-first (imutáveis); ícones/fontes → stale-while-revalidate; navegação → network-first com fallback para `/offline`; **APIs, Supabase e Server Actions nunca são cacheados pelo SW** |
| Atualização | SW novo fica em `waiting`; o app mostra "Nova versão disponível — Atualizar", que envia `SKIP_WAITING` e recarrega |
| Logout | envia `CLEAR_PRIVATE_CACHES` ao SW e limpa o IndexedDB do usuário |
| Conectividade | `useOffline` do Next (mais confiável que `navigator.onLine`) + estado da fila → **Online / Offline / Sincronizando / Sincronizado / Falha** |
| Fila offline | IndexedDB `kairos` → store `pending_operations` com `id` (UUID, também usado como chave de idempotência), `userId`, `companyId`, `operation`, `createdAt`, `payload`, `status`, `attempts`, `lastError`, `result` |
| Sincronização | envia para `/api/sync`; o servidor grava em `client_operations` (único por `client_op_id`) **na mesma transação** da operação, então reenvio nunca duplica. Conflito (ex.: saldo insuficiente no momento da sincronização) volta como `conflict` e o usuário decide |
| Regras offline | não confirma pagamento, não confirma venda, não baixa estoque definitivamente: a operação fica "pendente" até o servidor aceitar |
| Instalação | Android/Chrome: botão próprio via `beforeinstallprompt`. iOS: instruções "Compartilhar → Adicionar à Tela de Início" quando Safari não está em modo standalone |
| Push | Web Push com VAPID (Fase 10); no iOS só funciona com o app instalado (iOS 16.4+) |
| Mobile | navegação inferior: Início, Estoque, Produção, Pedidos, Mais. "Mais" lista todos os módulos. Áreas de toque ≥ 44 px e `safe-area-inset` |

Atenção ao `useOffline` do Next: ele **reenvia Server Actions automaticamente** quando a rede volta. Por isso toda mutação crítica recebe uma chave de idempotência gerada no cliente, mesmo fora da fila offline.

---

## 8. Integração WhatsApp (Evolution API)

```
Painel ──(Server Action)──► whatsappService ──HTTP + apikey──► Evolution API
   ▲                              │                                  │
   │ polling 3 s (máx. 2 min)     │ grava status em integration_instances
   └──── GET /api/integrations/whatsapp/status ◄── webhook CONNECTION_UPDATE / QRCODE_UPDATED
```

- URL e token ficam em `integration_secrets` (criptografados). O navegador nunca recebe o token.
- Conectar: servidor chama `instance/create` (ou usa a existente) e `instance/connect/{instance}`; o QR Code (base64) volta **apenas na resposta** para o painel e não é persistido. Renovar QR = nova chamada.
- Estado: `instance/connectionState/{instance}` por polling controlado enquanto a tela está aberta + webhook para mudanças em segundo plano. Desconectar/reconectar via `instance/logout` e `connect`.
- Automações: evento de domínio (ex.: `order.paid`) → regras ativas → mensagem renderizada com variáveis → `message_queue` com `dedupe_key = regra + evento + pedido` (único) → worker (Vercel Cron/pg_cron) envia respeitando limite por minuto, horário configurado e consentimento do cliente → `notification_logs`.
- Monitoramento: instância caída marca `integrations.status = 'desconectado'` e gera alerta no painel.
- Limitação assumida: conexão via WhatsApp Web pode cair ou ser restringida pela plataforma; não há garantia de conexão permanente.

## 9. Integração Asaas

- Configuração em Configurações → Integrações → Asaas: chave API (criptografada), ambiente (`sandbox` → `https://api-sandbox.asaas.com/v3`, `production` → `https://api.asaas.com/v3`), token do webhook gerado pelo sistema, teste de conexão (`GET /myAccount` ou equivalente).
- Checkout: `fn_create_order` (transação: pedido + itens + reserva de estoque com expiração) → servidor cria/recupera cliente no Asaas → cria cobrança (Pix/boleto/link) com `externalReference = order.id` → grava `payments`.
- Webhook `/api/webhooks/asaas`: valida token → insere em `webhook_events` (duplicado = responde 200 e ignora) → `fn_confirm_order_payment` (transação: pagamento, status do pedido, consumo da reserva/baixa de estoque, recebimento financeiro, evento para automação WhatsApp).
- Nunca confia no retorno do checkout: o pedido só vira "Pago" pelo webhook ou por consulta ativa ao Asaas.
- Cancelamento/estorno: eventos `PAYMENT_REFUNDED`, `PAYMENT_DELETED` etc. geram estornos auditáveis.
- Produção só é habilitada depois do teste de ponta a ponta em sandbox.

---

## 10. Plano de fases e critérios de aceite

| Fase | Escopo | Critério de aceite |
|---|---|---|
| 0 | Auditoria e arquitetura (este documento) | Documento aprovado |
| 1 | Fundação + PWA: Next/TS/Tailwind, Supabase, auth, migrations de tenancy/RLS/auditoria, layout e identidade, manifest, SW, ícones, navegação mobile, cache, status de conexão, fila offline | App publicado em ambiente de teste, login funcional, banco conectado, instalação PWA testada em Android e iOS |
| 2 | Produtos, categorias, matérias-primas, unidades e conversões, movimentações, inventário, alertas | Movimentações persistidas e saldos consistentes (testes de concorrência na função de movimentação) |
| 3 | Fichas técnicas, ordens de produção, custos, perdas, estornos | Produção transacional, sem baixa parcial |
| 4 | Clientes (LGPD), fornecedores, compras, recebimentos | Compras recebidas geram entrada de estoque |
| 5 | Pedidos, vendas, reservas, financeiro, fluxo de caixa | Pedidos e financeiro consistentes |
| 6 | Loja pública, catálogo, carrinho, checkout, SEO | Loja funcional integrada ao estoque |
| 7 | Editor "Personalizar minha loja" com rascunho/publicação/versões | Admin personaliza e publica sem código |
| 8 | Asaas | Pagamento sandbox ponta a ponta sem duplicidade |
| 9 | Evolution API / WhatsApp | QR Code no SaaS, mensagem de teste e automações |
| 10 | PWA avançada, push, performance, segurança, documentação, deploy final | Validação em computador e celular |

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Next 16.4 muito recente (APIs novas, `useOffline` experimental) | Seguir a documentação empacotada em `node_modules/next/dist/docs`; isolar o uso de recursos experimentais |
| Reenvio automático de Server Actions offline duplicar operações | Chave de idempotência em toda mutação crítica |
| Conflitos de estoque após sincronização offline | Servidor revalida tudo; conflito é devolvido ao usuário, nunca resolvido em silêncio |
| iOS: sem `beforeinstallprompt`, push só instalado, armazenamento pode ser limpo | Instruções de instalação; não depender do IndexedDB como fonte de verdade |
| Evolution API (não oficial) pode cair ou violar regras do WhatsApp | Monitoramento, reconexão assistida, limites de envio, só mensagens transacionais/consentidas |
| Funções serverless da Vercel com limite de tempo para filas | Lotes pequenos via cron; mover worker para Edge Function do Supabase se necessário |
| Sem logo oficial | Monograma provisório, substituição pontual em `public/brand` e regeneração de ícones |
| LGPD (CPF, telefone, endereço) | Minimização, consentimento, RLS, nada sensível em logs |
