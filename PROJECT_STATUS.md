# PROJECT_STATUS — SAS Kairós

Estados: **Não iniciado · Em desenvolvimento · Implementado · Testado · Concluído · Bloqueado**
Uma fase só é **Concluída** quando o critério de aceite é atendido no ambiente de teste.

Última atualização: 27/11/2026

## Resumo

| Fase | Status | Observação |
|---|---|---|
| 0 — Auditoria e planejamento | Concluído | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 1 — Fundação + PWA | **Concluído** (aceito em 24/11/2026) | Publicado na Vercel, login e banco validados pelo usuário. Pendente: teste de instalação em Android/iPhone reais |
| 2 — Produtos e estoque | **Concluído** (aceito em 25/11/2026) | Publicado em produção. Pendentes menores: leitor de código de barras pela câmera, teste offline no aparelho |
| 3 — Produção | **Concluído** (aceito em 27/11/2026) | Publicado em produção |
| 4 — Clientes, fornecedores e compras | **Testado** (aguardando validação) | Falta aplicar `20261127000100_partners_purchases.sql` e validar no Preview do branch `fase-4-compras` |
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
| ~~Projeto Supabase + migration da fundação~~ | — | feito em 24/11 |
| ~~Projeto Vercel + variáveis de ambiente~~ | — | feito em 24/11 (`saas-kairos.vercel.app`) |
| ~~Migrations da Fase 2~~ | — | aplicadas em 25/11 |
| ~~Migration da Fase 3~~ | — | aplicada em 26/11 |
| Aplicar `20261127000100_partners_purchases.sql` no SQL Editor | Fase 4 no ambiente publicado | dev |
| Aparelho Android e iPhone para teste de instalação | Pendência da Fase 1 | Kairós |
| Transferir a propriedade do sistema para o responsável da Kairós (hoje o proprietário é a conta do desenvolvedor) | Entrega | Kairós / dev — tela de Equipe |

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
2. Importar o repositório na Vercel e cadastrar as variáveis (código já está no GitHub).
3. Validar no preview: login, criação da empresa, edição em Configurações, Status do app mostrando "Banco de dados: Conectado".
4. Instalar no Android (Chrome) e no iPhone (Safari) e abrir em modo aplicativo.

## Fase 2 — Produtos, matérias-primas e estoque

Critério: *movimentações persistidas e saldos consistentes (testes de concorrência na função de movimentação).*

| Funcionalidade | Status | Arquivos | Testes | Pendências |
|---|---|---|---|---|
| Empresa única (2ª empresa recusada; novo usuário vê "acesso não liberado") | Testado | `supabase/migrations/20261125000100_single_company.sql`, `src/app/onboarding/page.tsx` | 4 testes (`single-company.test.ts`) | liberar acesso de funcionários: tela Equipe |
| Unidades de medida (sistema + personalizadas) e conversões; massa↔volume por densidade | Testado | migration de estoque, `src/modules/inventory/domain.ts`, Configurações | banco (kg→g, l→g com densidade, recusa sem densidade/dimensão errada) + 5 testes de domínio | — |
| Categorias em árvore (sem ciclos, sem cruzar empresas) | Testado | `src/app/admin/produtos/categorias/*` | ciclo e FK entre empresas | — |
| Produtos: cadastro, SKU/código de barras únicos, preço, custo, margem, mínimo, situação, "exibir na loja" | Testado | `src/app/admin/produtos/*` | RLS por papel, SKU único, validação de preço | leitor de código de barras pela câmera (adiado; leitor USB funciona) |
| Fotos de produtos (até 8, principal, redução automática no aparelho, bucket com RLS por empresa e papel) | Testado | `20261125000300_product_images.sql`, `src/app/admin/produtos/[id]/product-photos.tsx` | 4 testes (bucket, envio por papel/empresa, caminho do produto, limite) | o cadastro dos produtos será feito pela proprietária |
| Matérias-primas: unidade, densidade, mínimo, último custo | Testado | `src/app/admin/materias-primas/*` | conversão e custo convertido | fornecedor preferencial entra na Fase 4 |
| Movimentação transacional (`fn_register_stock_movement`): entrada, saída, ajuste, perda, descarte, devolução | Testado | migration de estoque, `src/app/admin/movimentacoes/*` | 11 testes + **4 testes de concorrência em PostgreSQL 17 real** | — |
| Custo médio ponderado | Testado | `private.apply_stock_movement` | 2 testes | — |
| Estoque negativo bloqueado (opção da empresa em Configurações) | Testado | Configurações → Estoque | 2 testes | — |
| Estorno (uma vez, motivo obrigatório, só gerente+; documentos só pelo próprio documento) | Testado | `fn_reverse_stock_movement` | 4 testes + estorno simultâneo | — |
| Movimentações imutáveis; saldos sem escrita pela API | Testado | triggers e `revoke` | 3 testes | — |
| Inventário: abre com saldo do sistema, contagem por item (salva sozinha), aplica ajustes só nas diferenças | Testado | `src/app/admin/estoque/inventario/*` | 4 testes | — |
| Tela Estoque (abas, busca, valor em estoque) e alertas de mínimo (Dashboard) | Implementado | `src/app/admin/estoque/page.tsx`, `src/app/admin/page.tsx` | visão testada no banco | validação visual no ambiente publicado |
| Movimentação offline: fila no aparelho, envio automático, mesma chave de idempotência; conflitos ficam para o usuário decidir (Status do app) | Implementado | `movement-form.tsx`, `src/app/api/sync/route.ts`, `sync-manager.tsx`, `pending-operations.tsx` | idempotência (banco + concorrência) e motor de sync (unitários); rota responde 401 sem sessão | teste manual offline no aparelho |

Resultado: **77 testes passando** (`npm test`), lint e build sem erros.

### Como validar a Fase 2

1. No Supabase → SQL Editor, executar em ordem `20261125000100_single_company.sql`, `20261125000200_inventory.sql` e `20261125000300_product_images.sql`.
2. Abrir o preview da Vercel do branch `fase-2-estoque`.
3. Cadastrar uma matéria-prima em gramas e dar entrada em kg; conferir o saldo convertido.
4. Cadastrar um produto, dar entrada, tentar uma saída maior que o saldo (deve recusar), estornar uma movimentação.
5. Abrir um inventário, contar um item com diferença e aplicar; conferir o ajuste em Movimentações.
6. No celular: desligar a internet com a tela "Registrar movimentação" aberta, lançar, religar e conferir em Status do app.

## Fase 3 — Produção

Critério: *produção transacional, sem baixa parcial.*

| Funcionalidade | Status | Arquivos | Testes | Pendências |
|---|---|---|---|---|
| Ficha técnica por produto: rendimento, perda prevista (%), insumos em qualquer unidade compatível | Testado | `supabase/migrations/20261126000100_production.sql`, `src/app/admin/producao/fichas/*` | conversão, insumo repetido, unidade incompatível, permissão | — |
| Versões da ficha (salvar = nova versão; anteriores imutáveis; histórico na tela) | Testado | `fn_save_recipe`, trigger `recipe_guard` | 2 testes | — |
| Custo estimado e margem da ficha com o custo atual dos insumos (médio; sem ele, o último) | Testado | `src/modules/production/domain.ts` | 4 testes de domínio | — |
| Ordem de produção: numeração OP-0001 por empresa, necessidade de insumos × saldo | Testado | `fn_create_production_order`, `src/app/admin/producao/nova/*` | cálculo igual ao banco, numeração | — |
| Concluir ordem: consumo real ajustável, quantidade produzida (perda), tudo ou nada | Testado | `fn_complete_production_order`, `src/app/admin/producao/[id]/*` | 6 testes + **4 testes de concorrência em PostgreSQL 17 real** | — |
| Custo real da produção (consumo × custo médio do insumo) → custo médio e custo do produto | Testado | mesma função | custo, custo incompleto sem distorcer o médio | — |
| Cancelar ordem em aberto; estornar ordem concluída (gerente+, uma vez, sem saldo negativo) | Testado | `fn_cancel_production_order`, `fn_reverse_production_order` | 3 testes + estorno simultâneo | — |
| Conclusão offline: fila no aparelho com a mesma chave de idempotência; falta de insumo vira conflito | Implementado | `complete-form.tsx`, `/api/sync` (`production.complete`) | idempotência no banco e em concorrência | teste manual offline no aparelho |
| Integração: movimentações ligadas à ordem, unidade de estoque travada por ficha, ordens em aberto no Dashboard | Implementado | `movement-table.tsx`, páginas de produto e matéria-prima, `src/app/admin/page.tsx` | build | validação visual |

Resultado: **107 testes passando** (`npm test`), lint, typecheck e build sem erros.

### Como validar a Fase 3

1. No Supabase → SQL Editor, executar `20261126000100_production.sql`.
2. Ter ao menos 2 matérias-primas com entrada **com custo** (ex.: cera em g, pavio em un) e 1 produto.
3. Produção → Fichas técnicas → produto: montar a ficha (ex.: rende 1 un, 200 g de cera + 1 pavio) e conferir custo estimado e margem. Salvar de novo com outra quantidade e ver a versão 2 no histórico.
4. Produção → Nova ordem: produzir 3; conferir a necessidade × estoque.
5. Na ordem, concluir com consumo real diferente do planejado; conferir saldos (Estoque), custo por unidade e as movimentações "Consumo na produção"/"Entrada da produção".
6. Abrir outra ordem maior que o estoque de um insumo e tentar concluir: deve recusar sem baixar nada.
7. Estornar a ordem concluída e conferir que os saldos voltaram.

## Fase 4 — Clientes, fornecedores e compras

Critério: *compras recebidas geram entrada de estoque.*

| Funcionalidade | Status | Arquivos | Testes | Pendências |
|---|---|---|---|---|
| Clientes: cadastro (CPF/CNPJ opcional e único, contatos, endereço, nascimento), busca, CPF mascarado nas listas | Testado | `supabase/migrations/20261127000100_partners_purchases.sql`, `src/app/admin/clientes/*` | permissão por papel, CPF único, isolamento entre empresas | histórico de compras do cliente (Fase 5) |
| Consentimentos LGPD (WhatsApp e marketing) com data carimbada pelo banco e histórico imutável (quem, quando, origem) | Testado | triggers `customer_before_write` e `customer_log_consent` | concessão/revogação, data não forjável, histórico imutável | — |
| Auditoria sem dados pessoais em claro (campos pessoais mascarados) | Testado | `private.audit_row_masked` | nenhum CPF/e-mail/telefone/nome no log | — |
| Exportação dos dados do titular (JSON, registrada na auditoria) e anonimização irreversível (proprietário/admin, motivo + confirmação) | Testado | `fn_log_customer_export`, `fn_anonymize_customer`, `/admin/clientes/[id]/exportar` | anonimização (papel, dados removidos, edição bloqueada, consentimentos revogados) | — |
| Fornecedores: cadastro, fornecedor preferencial da matéria-prima, pedidos por fornecedor | Testado | `src/app/admin/fornecedores/*`, cadastro de matéria-prima | papel, FK entre empresas | — |
| Pedido de compra: numeração PC-0001, itens (matéria-prima ou produto de revenda) em unidade de compra (ex.: kg com estoque em g), total | Testado | `fn_save_purchase_order`, `src/app/admin/compras/*` | numeração, total, unidade incompatível, papel | — |
| Situação: rascunho → enviado → recebido em parte → recebido; cancelar (sem recebimento); encerrar saldo pendente | Testado | `fn_set_purchase_order_status` | 2 testes | — |
| Recebimento (conferência): parcial ou total, preço real, NF; entrada "Compra" no estoque com custo convertido, custo médio e último custo | Testado | `fn_receive_purchase` | 3 testes + **2 testes de concorrência em PostgreSQL 17** (nunca recebe acima do pedido, reenvio aplica uma vez) | recebimento offline (não previsto) |
| Estorno de recebimento (gerente+, uma vez, sem saldo negativo) | Testado | `fn_reverse_purchase_receipt` | 2 testes | — |
| Integração: movimentações ligadas ao pedido, compras aguardando recebimento no Dashboard | Implementado | `movement-table.tsx`, `src/app/admin/page.tsx` | build | validação visual |

Resultado: **134 testes passando** (`npm test`), lint, typecheck e build sem erros.

### Como validar a Fase 4

1. No Supabase → SQL Editor, executar `20261127000100_partners_purchases.sql`.
2. Abrir o Preview do branch `fase-4-compras` na Vercel.
3. Clientes: cadastrar um cliente com WhatsApp autorizado; desmarcar depois e conferir o histórico de consentimentos. Exportar os dados (JSON).
4. Fornecedores: cadastrar um fornecedor e defini-lo como preferencial de uma matéria-prima.
5. Compras: criar um pedido com uma matéria-prima em **kg** (estoque em g) e preço por kg; marcar como enviado.
6. Receber só parte; conferir em Estoque o saldo em gramas e o custo por grama; receber o restante com outro preço e conferir o custo médio.
7. Estornar um recebimento e conferir o saldo.
8. (Opcional, irreversível) Anonimizar um cliente de teste.

## Decisões registradas

- **Service Worker próprio** em vez de plugin (ver ARCHITECTURE §3).
- **Regras críticas no Postgres** em funções transacionais; tabelas de movimentação sem escrita direta pela API.
- **Rotas do painel em `/admin`** e loja na raiz; PWA com `start_url=/admin`.
- **Cores de texto derivadas** ("tinta") adicionadas à paleta por acessibilidade — a paleta oficial não foi alterada.
- **Um usuário ↔ uma empresa** na versão 1 (multi-empresa por usuário fica para a fase SaaS).
- **Instalação de empresa única** (`private.app_config.single_company`). A estrutura multi-empresa e o RLS continuam; virar SaaS é desligar a opção.
- **Unidade de estoque fixa** após a primeira movimentação (evita saldos reinterpretados em outra unidade).
- **Inventário aplica "saldo = contado"** usando o saldo do momento da aplicação; a tela mostra quando o saldo mudou desde a abertura.
- **Ajustes de inventário não são estornados avulsos** (pertencem ao documento de inventário).
- **Ficha técnica versionada e imutável**: cada ordem guarda a versão usada; alterar a ficha nunca muda custos passados.
- **Perda prevista da ficha** é acrescida ao consumo (fator 1 + perda%). A perda real aparece como produzido < planejado e como consumo real.
- **Insumos da ficha são só matérias-primas** (produto dentro de produto fica para quando houver necessidade real).
- **Custo da produção** = Σ consumo real × custo médio do insumo no momento (sem custo médio, último custo). Se algum insumo não tem custo, a ordem fica com custo "incompleto" e não altera o custo médio nem o custo cadastrado do produto.
- **Conclusão tudo ou nada**: insumos travados em ordem fixa (id) para não haver deadlock entre ordens simultâneas.
- **Estorno de produção** devolve os insumos sem alterar o custo médio deles e não restaura o "custo" cadastrado do produto (fica o da última produção).
- **Cliente não é excluído, é anonimizado** (mantém o histórico de vendas sem dados pessoais). Consentimento sempre opt-in, com data carimbada pelo banco.
- **Auditoria mascara dados pessoais** de clientes e fornecedores (registra só que o campo mudou).
- **Pedido de compra só é editado antes do primeiro recebimento**; depois, corrige-se estornando o recebimento ou encerrando o saldo.
- **Recebimento usa o preço informado na chegada** como custo de entrada (pode diferir do pedido). Frete/rateio e contas a pagar ficam para o financeiro (Fase 5).
- **Abrir ordem exige conexão** (numeração e ficha vigente vêm do servidor); **concluir** pode ser feito offline e é validado no servidor ao sincronizar.
