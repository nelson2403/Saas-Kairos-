# SAS Kairós

> ONDE O AGORA SE TORNA ABRIGO

ERP + estoque + produção + loja virtual da Kairós, entregue como aplicativo PWA.
Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres, Auth, Storage) · Vercel.

- Arquitetura e decisões: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Andamento por fase: [PROJECT_STATUS.md](PROJECT_STATUS.md)

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as chaves do Supabase
npm run dev                  # http://localhost:3000
```

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento (Service Worker desligado) |
| `npm run build && npm start` | build de produção local (Service Worker ativo) |
| `npm test` | testes: banco em PGlite (migrations + RLS), concorrência em PostgreSQL 17 embutido (baixado pelo npm) e unidades |
| `npm run lint` | ESLint |
| `npm run icons` | regenera ícones do PWA a partir de `public/brand/logo.svg` |
| `npm run pwa:check -- http://localhost:3000 <pasta>` | verificação do PWA em navegador real (Edge/Chrome instalado) |

## Configurando o Supabase (uma vez)

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo recomendada).
2. Aplique as migrations de `supabase/migrations/` em ordem de nome (a cada fase surgem novas; aplique só as que ainda não rodou) — pelo **SQL Editor** (colar e executar cada arquivo) ou com a Supabase CLI (`supabase link` + `supabase db push`).
3. **Authentication → Sign In / Providers**: mantenha E-mail habilitado e **desative "Allow new users to sign up"** (o painel é restrito à equipe).
4. **Authentication → Users → Add user**: crie o usuário administrador com e-mail e senha.
5. **Authentication → URL Configuration**: Site URL = URL do ambiente (ex.: a URL de preview da Vercel).
6. Copie `Project URL`, a publishable key e a secret key para `.env.local` / Vercel.
7. Entre em `/login`. No primeiro acesso o sistema pede o cadastro da empresa e torna esse usuário **Proprietário**.

## Deploy (Vercel)

1. Importe o repositório na Vercel (framework detectado: Next.js).
2. Cadastre as variáveis de `.env.example` para **Preview** e, depois de validado, **Production**.
3. Cada push em branch gera um Preview; produção só após validação da fase.

Nunca versionar `.env.local` nem chaves. A `SUPABASE_SECRET_KEY` e a `INTEGRATIONS_ENCRYPTION_KEY` existem apenas no servidor.

## Instalando como aplicativo

- **Android (Chrome)**: abra o painel → botão *Instalar aplicativo* (Início ou Status do app), ou menu ⋮ → *Instalar app*.
- **iPhone/iPad (Safari)**: Compartilhar → *Adicionar à Tela de Início*.
- Requer HTTPS (a URL da Vercel já atende). Em `localhost` o Chrome também permite instalar.

## Marca

A logo oficial ainda não foi entregue. O app usa uma assinatura tipográfica ("KAIRÓS") e um monograma **provisório** nos ícones.
Para aplicar a logo oficial: salve-a em `public/brand/logo.svg`, rode `npm run icons` e troque o conteúdo de `src/components/brand/logo.tsx` pela imagem — sem alterar proporção ou símbolo.

A Paleta Mineral oficial está em `src/app/globals.css`. Dois tons escuros derivados ("tinta") são usados só em textos, porque nenhuma cor da paleta atinge contraste legível sobre o Marfim de Cera.
