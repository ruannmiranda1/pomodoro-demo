# Pomodoro — plano de implementação

App de demonstração full-stack: Next.js (App Router) + Supabase (banco e auth) + Vercel.
O protótipo navegável está em `prototipo/` e é a referência de tela e de comportamento.

## Decisões fechadas na entrevista (20/10/2026)

| Tema | Decisão |
|---|---|
| Escopo | Timer (foco / pausa curta / pausa longa) + durações configuráveis + tarefas vinculadas + som e notificação. **Sem** histórico/estatísticas. |
| Conta | Timer funciona **sem login**. Login é opcional, só para sincronizar tarefas e configurações. |
| Método de login | E-mail + senha (Supabase Auth): entrar, criar conta, esqueci a senha, redefinir senha. |
| Primeiro login | Dados locais (tarefas + config) são **importados automaticamente**; a tela de Entrar avisa antes. |
| Contagem | Fim de um foco soma +1 automaticamente na tarefa ativa. Foco pulado não conta. |
| Confirmação de e-mail | **Desligada** (demo). Criar conta já entra; o único e-mail que o app manda é o de redefinir senha. |
| Supabase | **Projeto novo**, plano free, só para esta demo. |
| Repo e domínio | Repo **público** no GitHub pessoal; deploy em `*.vercel.app`, sem domínio próprio. |
| Runtime | **Bun** (`bun.lock`; a Vercel detecta sozinha). |
| Visual | Design system VAMOO AI (`@vamoo/design-system`, commit `83356a5` usado no protótipo). Modos se distinguem por superfície (surface / accent-soft / night), sem paleta própria por modo. |

## Telas → rotas

| Protótipo | Rota Next.js | Tipo |
|---|---|---|
| `index.html` | `/` | Client Component (timer + tarefas) |
| `configuracoes.html` | `/configuracoes` | Client Component |
| `entrar.html#entrar` / `#criar` | `/entrar` (`?modo=criar`) | Client + Server Action |
| `entrar.html#esqueci` | `/entrar/esqueci` | Server Action |
| `entrar.html#enviado` | estado interno de `/entrar/esqueci` | — |
| `entrar.html#redefinir` | `/entrar/redefinir` | destino do link de reset |
| — | `/auth/callback` | Route Handler (`exchangeCodeForSession`) |

## Modelo de dados (Supabase)

```sql
create table public.configuracoes (
  user_id uuid primary key references auth.users on delete cascade,
  foco smallint not null default 25 check (foco between 1 and 120),
  curta smallint not null default 5 check (curta between 1 and 60),
  longa smallint not null default 15 check (longa between 1 and 60),
  intervalo_longa smallint not null default 4 check (intervalo_longa between 2 and 10),
  auto_pausa boolean not null default false,
  auto_foco boolean not null default false,
  som text not null default 'sino' check (som in ('sino','digital','madeira','nenhum')),
  volume real not null default 0.6 check (volume between 0 and 1),
  notificar boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  nome text not null check (char_length(nome) between 1 and 120),
  estimativa smallint not null check (estimativa between 1 and 20),
  feitos smallint not null default 0 check (feitos >= 0),
  concluida boolean not null default false,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index on public.tarefas (user_id, ordem);
```

RLS ligada nas duas tabelas, política única por tabela: `using (user_id = auth.uid()) with check (user_id = auth.uid())` para `select/insert/update/delete`, papel `authenticated`. `anon` não acessa nada: sem login o app nem chama o Supabase.

Incremento do pomodoro via RPC para não perder contagem em duas abas:
`create function incrementar_feitos(p_tarefa uuid) ... update tarefas set feitos = feitos + 1 where id = p_tarefa and user_id = auth.uid()` (`security invoker`).

O estado do timer (modo, `fimEm`, focos do dia) **fica só no localStorage** mesmo logado — é efêmero e por aparelho. Sincronizar timer entre aparelhos não foi pedido.

## Camada de dados no cliente

Um `repositorio` com a mesma interface nos dois modos: `LocalRepo` (localStorage, chaves `pomodoro:*` como no protótipo) e `SupabaseRepo`. O hook `useRepo()` escolhe pela sessão. Assim as telas não sabem se há login.

Importação no primeiro login (após `signInWithPassword` e após `signUp`, que já devolve sessão com a confirmação desligada; no `/auth/callback` só para o fluxo de reset):
1. Lê tarefas + config do localStorage.
2. Se `configuracoes` do usuário não existe → `insert` com a config local; se existe, mantém a do servidor.
3. `insert` das tarefas locais (sem `id`, para não colidir), na ordem.
4. Só depois de sucesso, limpa `pomodoro:tarefas` e `pomodoro:config` e mostra o toast "Conta conectada · N tarefas importadas". Falhou → mantém o local e avisa.

Sair (`signOut`) volta a ler do localStorage, que estará vazio — esperado.

## Regras do timer (já validadas no protótipo — não mudar)

- O restante sai de `fimEm` (timestamp), nunca de um contador decrementado: aba em background estrangula `setInterval`.
- `AudioContext` nasce/resume no clique de Iniciar (política de autoplay). Som sintetizado com WebAudio, sem arquivo.
- `Notification.requestPermission()` só dentro de um clique. Mostrar os três estados (`default`, `granted`, `denied`); `denied` só se desfaz no cadeado do navegador.
- Pausa longa a cada `intervalo_longa` focos concluídos; foco pulado vai para pausa curta e não conta.
- "Focos hoje" zera na virada do dia local.
- Título da aba mostra `MM:SS · Modo`. Espaço inicia/pausa fora de campos.
- Trocar de modo com o timer rodando pede confirmação.

## Estrutura do projeto

```
app/
  layout.tsx            # importa @vamoo/design-system/styles + fonte via next/font
  page.tsx              # timer + tarefas
  configuracoes/page.tsx
  entrar/page.tsx | esqueci/page.tsx | redefinir/page.tsx
  auth/callback/route.ts
components/  Topbar, Timer, ListaTarefas, NovaTarefa, Toast
lib/
  supabase/{client,server,middleware}.ts   # @supabase/ssr
  repo/{local,supabase,index}.ts
  timer.ts              # funções puras: proximoModo, restante, fmt
  som.ts
middleware.ts           # refresh de sessão (não bloqueia rota: tudo é público)
supabase/migrations/
```

`lib/timer.ts` é puro e testado em unidade; é onde mora a lógica que já deu bug no protótipo.

## Fases

0. **Infra** — repo público `pomodoro-demo` no GitHub pessoal (push deste repo local); projeto Supabase novo (região `sa-east-1`); em Auth → Providers → Email, desligar "Confirm email"; projeto na Vercel importando o repo.
1. **Base** — `bunx create-next-app` (TS, ESLint, App Router), `@vamoo/design-system`, Topbar e tema claro/escuro com os quatro blocos.
2. **Timer local** — porta do protótipo para `Timer` + `lib/timer.ts` com testes (Vitest): ciclo foco→curta→…→longa, pular, virada de dia, cálculo por `fimEm`.
3. **Tarefas e configurações locais** — `LocalRepo`, CRUD, contagem automática.
4. **Supabase** — migrations + RLS + RPC; teste de RLS (usuário A não lê tarefa de B) em pgTAP ou script.
5. **Auth** — `/entrar`, criar conta, esqueci/redefinir, callback, importação automática.
6. **Deploy** — env `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` na Vercel (Preview e Production); no Supabase, Site URL = `https://pomodoro-demo.vercel.app` e Redirect URLs = `https://pomodoro-demo.vercel.app/auth/callback` + `https://pomodoro-demo-*.vercel.app/auth/callback` (previews) + `http://localhost:3000/auth/callback`. Só a anon key vai pro cliente; a service role não entra no projeto.
7. **E2E** — Playwright: timer curto (config de teste), tarefa conta +1, criar conta importa tarefas, RLS pela UI.

Gate de cada PR: `bun run type-check` + `bun run lint` + `bun run test`; antes do deploy, `bun run build` + E2E. Como o repo é público, `.env.local` fica no `.gitignore` e o `.env.example` vai commitado só com as chaves.

Risco aceito: com a confirmação desligada, qualquer e-mail (inclusive de outra pessoa) cria conta. Para uma demo pública é aceitável; se virar produto, ligar a confirmação com SMTP próprio (Resend).
