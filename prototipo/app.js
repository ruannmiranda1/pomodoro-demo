// Estado compartilhado do protótipo. No app real, `config` e `tarefas` vão
// para o Supabase quando há sessão; sem sessão ficam no localStorage, como aqui.

const CHAVES = {
  config: "pomodoro:config",
  tarefas: "pomodoro:tarefas",
  timer: "pomodoro:timer",
  sessao: "pomodoro:sessao",
  tema: "pomodoro:tema",
  dicaFechada: "pomodoro:dica-fechada",
  toast: "pomodoro:toast",
};

const CONFIG_PADRAO = {
  foco: 25,
  curta: 5,
  longa: 15,
  intervaloLonga: 4,
  autoPausa: false,
  autoFoco: false,
  som: "sino",
  volume: 0.6,
  notificar: true,
};

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {}
}

const store = {
  config: () => ({ ...CONFIG_PADRAO, ...ler(CHAVES.config, {}) }),
  salvarConfig: (c) => gravar(CHAVES.config, c),
  tarefas: () => ler(CHAVES.tarefas, []),
  salvarTarefas: (t) => gravar(CHAVES.tarefas, t),
  sessao: () => ler(CHAVES.sessao, null),
  entrar: (email) => gravar(CHAVES.sessao, { email }),
  sair: () => localStorage.removeItem(CHAVES.sessao),
};

// ---------- tema ----------

function aplicarTema() {
  const tema = ler(CHAVES.tema, null);
  if (tema) document.documentElement.dataset.theme = tema;
  else delete document.documentElement.dataset.theme;
}

function alternarTema() {
  const atual =
    document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  gravar(CHAVES.tema, atual === "dark" ? "light" : "dark");
  aplicarTema();
}

aplicarTema();

// ---------- toast ----------

function toast(texto, ms = 3200) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), ms);
}

// toast que sobrevive a um redirect (ex.: depois do login)
function toastDepois(texto) {
  sessionStorage.setItem(CHAVES.toast, texto);
}

// ---------- som ----------
// Sintetizado com WebAudio: sem arquivo, sem requisição. O AudioContext só
// nasce num clique (política de autoplay) — `destravarAudio()` no Start.

let audioCtx;

function destravarAudio() {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

const SONS = {
  sino: [[880, 0], [1318.5, 0.18], [880, 0.6], [1318.5, 0.78]],
  digital: [[1000, 0], [1000, 0.15], [1000, 0.3], [1000, 0.6], [1000, 0.75], [1000, 0.9]],
  madeira: [[420, 0], [420, 0.25], [560, 0.5]],
};

function tocar(som, volume) {
  if (som === "nenhum") return;
  destravarAudio();
  const agora = audioCtx.currentTime;
  for (const [freq, t] of SONS[som] ?? SONS.sino) {
    const osc = audioCtx.createOscillator();
    const ganho = audioCtx.createGain();
    osc.type = som === "digital" ? "square" : som === "madeira" ? "triangle" : "sine";
    osc.frequency.value = freq;
    const dur = som === "sino" ? 0.9 : 0.12;
    ganho.gain.setValueAtTime(0.0001, agora + t);
    ganho.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001) * 0.4, agora + t + 0.01);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + t + dur);
    osc.connect(ganho).connect(audioCtx.destination);
    osc.start(agora + t);
    osc.stop(agora + t + dur + 0.05);
  }
}

// ---------- header ----------

function montarConta() {
  const alvo = document.querySelector("[data-conta]");
  if (!alvo) return;
  const sessao = store.sessao();
  if (sessao) {
    alvo.innerHTML = `
      <span class="conta" title="Sincronizado">
        <span class="avatar">${sessao.email[0].toUpperCase()}</span>
        <span class="email">${sessao.email}</span>
      </span>
      <button class="navlink" data-sair>Sair</button>`;
    alvo.querySelector("[data-sair]").onclick = () => {
      store.sair();
      toast("Você saiu. O timer continua funcionando neste navegador.");
      montarConta();
      document.dispatchEvent(new Event("sessao"));
    };
  } else {
    alvo.innerHTML = `<a class="btn btn-ghost btn-entrar" href="entrar.html">Entrar</a>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("[data-tema]")?.addEventListener("click", alternarTema);
  montarConta();
  const pendente = sessionStorage.getItem(CHAVES.toast);
  if (pendente) {
    sessionStorage.removeItem(CHAVES.toast);
    toast(pendente, 4500);
  }
});
