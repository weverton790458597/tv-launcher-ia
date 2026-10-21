/* Gemini TV Launcher — lógica da interface.
 * Roda dentro da WebView do Android (window.Android = ponte nativa) e também
 * no navegador do PC para testes (tecla "M" = microfone simulado por texto). */
(function () {
  "use strict";

  const CFG = Object.assign(
    { GEMINI_API_KEY: "", GEMINI_MODEL: "gemini-2.5-flash", USER_NAME: "", LOCALE: "pt-BR", MAX_HISTORY_TURNS: 8 },
    window.CONFIG || {}
  );
  const NATIVE = typeof window.Android !== "undefined";
  const $ = (id) => document.getElementById(id);

  const el = {
    clock: $("clock"), date: $("date"), net: $("net"), netLabel: $("net-label"),
    orb: $("orb"), user: $("user-line"), ai: $("ai-line"), status: $("status"),
    mic: $("mic"), apps: $("apps"),
  };

  let apps = [];
  let history = [];            // [{role:"user"|"model", text}]
  let state = "idle";          // idle | listening | thinking | speaking
  let pendingLaunch = null;    // {package, timer}
  let busy = false;

  // ------------------------------------------------------------------
  // Estado visual
  // ------------------------------------------------------------------
  function setState(s, statusText) {
    state = s;
    el.orb.dataset.state = s;
    el.mic.classList.toggle("active", s === "listening");
    if (statusText !== undefined) el.status.textContent = statusText;
  }
  const IDLE_HINT = "Pressione o botão de microfone do controle ou o botão Falar";

  function showAI(text) { el.ai.textContent = text; }
  function showUser(text) { el.user.textContent = text ? "“" + text + "”" : ""; }

  // ------------------------------------------------------------------
  // Relógio, data e rede
  // ------------------------------------------------------------------
  function tickClock() {
    const now = new Date();
    el.clock.textContent = now.toLocaleTimeString(CFG.LOCALE, { hour: "2-digit", minute: "2-digit" });
    el.date.textContent = now.toLocaleDateString(CFG.LOCALE, { weekday: "long", day: "numeric", month: "long" });
  }

  function updateNetwork() {
    let type = "none";
    if (NATIVE) {
      try { type = window.Android.getNetwork(); } catch (e) { type = "none"; }
    } else {
      type = navigator.onLine ? "wifi" : "none";
    }
    const labels = { wifi: "Wi-Fi conectado", ethernet: "Cabo conectado", other: "Conectado", none: "Sem rede" };
    el.net.dataset.state = type;
    el.netLabel.textContent = labels[type] || labels.none;
  }

  // ------------------------------------------------------------------
  // Apps
  // ------------------------------------------------------------------
  function loadApps() {
    if (NATIVE) {
      try { apps = JSON.parse(window.Android.getApps()); } catch (e) { apps = []; }
    } else {
      apps = [
        { name: "YouTube", package: "com.google.android.youtube.tv", icon: "" },
        { name: "Netflix", package: "com.netflix.ninja", icon: "" },
        { name: "Prime Video", package: "com.amazon.amazonvideo.livingroom", icon: "" },
        { name: "Configurações", package: "com.android.tv.settings", icon: "" },
      ];
    }
    renderApps();
  }

  function renderApps() {
    el.apps.textContent = "";
    apps.forEach((a, i) => {
      const tile = document.createElement("div");
      tile.className = "app-tile";
      tile.tabIndex = 0;
      tile.setAttribute("role", "listitem");
      tile.dataset.row = "apps";
      tile.dataset.index = String(i);

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      if (a.icon) {
        const img = document.createElement("img");
        img.src = a.icon;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.textContent = (a.name || "?").charAt(0).toUpperCase();
      }
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = a.name;

      tile.append(thumb, label);
      tile.addEventListener("click", () => launchApp(a.package));
      el.apps.appendChild(tile);
    });
  }

  function launchApp(pkg) {
    cancelPendingLaunch();
    if (!NATIVE) { showAI("(Teste no PC) abriria: " + pkg); return true; }
    let ok = false;
    try { ok = window.Android.openApp(pkg); } catch (e) { ok = false; }
    if (!ok) {
      showAI("Não consegui abrir esse app. Ele está instalado?");
      speak("Não consegui abrir esse app.");
    }
    return ok;
  }

  function cancelPendingLaunch() {
    if (pendingLaunch) { clearTimeout(pendingLaunch.timer); pendingLaunch = null; }
  }

  // ------------------------------------------------------------------
  // Voz (TTS)
  // ------------------------------------------------------------------
  function speak(text) {
    if (NATIVE) {
      try { window.Android.speak(text); return; } catch (e) { /* cai para o fallback */ }
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = CFG.LOCALE;
      u.onstart = () => window.onNativeEvent("tts_start", "");
      u.onend = () => window.onNativeEvent("tts_end", "");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else {
      window.onNativeEvent("tts_end", "");
    }
  }

  function stopSpeaking() {
    if (NATIVE) { try { window.Android.stopSpeaking(); } catch (e) {} }
    else if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ------------------------------------------------------------------
  // Gemini
  // ------------------------------------------------------------------
  function systemPrompt() {
    const now = new Date();
    const appList = apps.slice(0, 150).map((a) => `- ${a.name} => ${a.package}`).join("\n") || "(nenhum)";
    return [
      `Você é o assistente de voz da Smart TV de ${CFG.USER_NAME || "o usuário"}. Responda sempre em português do Brasil.`,
      `Data e hora atuais: ${now.toLocaleString(CFG.LOCALE)}.`,
      "",
      "Suas respostas serão LIDAS EM VOZ ALTA na TV: seja curto e direto (no máximo 2 frases),",
      "sem markdown, sem listas, sem emojis, sem URLs.",
      "",
      "Responda SEMPRE com um único objeto JSON, exatamente neste formato:",
      '{"speech": "texto falado ao usuário", "action": "none" | "open_app", "package": "nome.do.pacote" | null}',
      "",
      "Regras:",
      '1. Conversa livre (perguntas, curiosidades, história, notícias, conselhos): action="none", package=null, resposta em "speech".',
      '   Você não tem acesso a notícias em tempo real; se pedirem, diga isso com honestidade e ofereça o que souber.',
      '2. Se o usuário pedir para abrir/ver/assistir algo que corresponda a um app da lista abaixo (ex.: "abra o YouTube", "quero ver a Netflix"):',
      '   action="open_app" e package = EXATAMENTE o pacote da lista. Em "speech" confirme em poucas palavras (ex.: "Abrindo o YouTube.").',
      "3. Se o app pedido NÃO estiver na lista, use action=\"none\" e avise que ele não está instalado.",
      "4. Nunca invente pacotes que não estejam na lista.",
      "",
      "Apps instalados nesta TV:",
      appList,
    ].join("\n");
  }

  async function callGemini(contents, system, temperature) {
    if (!CFG.GEMINI_API_KEY || CFG.GEMINI_API_KEY.indexOf("COLE_") === 0) {
      throw new Error("NO_KEY");
    }
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(CFG.GEMINI_MODEL) + ":generateContent";
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
      },
    };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": CFG.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(to);
    }
    if (!res.ok) {
      const err = new Error("HTTP_" + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts;
    const text = parts ? parts.map((p) => p.text || "").join("") : "";
    if (!text) throw new Error("EMPTY");
    return text;
  }

  function parseModelJson(raw) {
    let t = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      const o = JSON.parse(t);
      return {
        speech: typeof o.speech === "string" ? o.speech : "",
        action: o.action === "open_app" ? "open_app" : "none",
        package: typeof o.package === "string" ? o.package : null,
      };
    } catch (e) {
      // O modelo não devolveu JSON: usa o texto como fala.
      return { speech: t, action: "none", package: null };
    }
  }

  function friendlyError(e) {
    if (e && e.message === "NO_KEY") return "Falta configurar a chave do Gemini no arquivo config.js.";
    if (e && e.name === "AbortError") return "O Gemini demorou demais para responder. Tente de novo.";
    if (e && (e.status === 400 || e.status === 403)) return "A chave do Gemini foi recusada. Verifique o config.js.";
    if (e && e.status === 429) return "Muitos pedidos ao Gemini agora. Tente de novo em instantes.";
    if (!navigator.onLine) return "A TV está sem internet.";
    return "Não consegui falar com o Gemini agora.";
  }

  // ------------------------------------------------------------------
  // Fluxos: saudação e conversa
  // ------------------------------------------------------------------
  function localGreeting() {
    const h = new Date().getHours();
    const p = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    return `${p}, ${CFG.USER_NAME || "tudo bem"}! O que vamos fazer hoje?`;
  }

  async function greet() {
    setState("thinking", "Preparando…");
    showAI("…");
    let text = localGreeting();
    try {
      const h = new Date().getHours();
      const periodo = h < 5 ? "madrugada" : h < 12 ? "manhã" : h < 18 ? "tarde" : "noite";
      const raw = await callGemini(
        [{ role: "user", parts: [{ text:
          `Gere um cumprimento curto e caloroso para ${CFG.USER_NAME || "o usuário"}, ` +
          `que acabou de ligar a TV de ${periodo} (são ${new Date().toLocaleTimeString(CFG.LOCALE, { hour: "2-digit", minute: "2-digit" })}). ` +
          `Termine perguntando o que vão fazer hoje. Máximo 15 palavras.` }] }],
        systemPrompt(), 1.0
      );
      const parsed = parseModelJson(raw);
      if (parsed.speech) text = parsed.speech;
    } catch (e) {
      // Sem chave/sem rede: usa a saudação local, e avisa na tela se for configuração.
      if (e && e.message === "NO_KEY") el.status.textContent = friendlyError(e);
    }
    say(text);
  }

  function say(text) {
    showAI(text);
    setState("speaking", "");
    speak(text);
  }

  async function ask(userText) {
    if (busy) return;
    busy = true;
    showUser(userText);
    setState("thinking", "Pensando…");

    history.push({ role: "user", text: userText });
    const maxMsgs = CFG.MAX_HISTORY_TURNS * 2;
    if (history.length > maxMsgs) history = history.slice(-maxMsgs);

    try {
      const raw = await callGemini(
        history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        systemPrompt(), 0.6
      );
      const r = parseModelJson(raw);
      const speech = r.speech || (r.action === "open_app" ? "Abrindo." : "Hmm, não entendi. Pode repetir?");
      history.push({ role: "model", text: speech });

      if (r.action === "open_app" && r.package) {
        const known = apps.find((a) => a.package === r.package);
        if (known || !NATIVE) {
          // Fala a confirmação e abre o app quando a fala terminar (com limite de tempo).
          cancelPendingLaunch();
          pendingLaunch = { package: r.package, timer: setTimeout(() => {
            const p = pendingLaunch; pendingLaunch = null;
            if (p) launchApp(p.package);
          }, 3500) };
          say(speech);
        } else {
          say("Não encontrei esse app instalado na TV.");
        }
      } else {
        say(speech);
      }
    } catch (e) {
      history.pop(); // não guarda a pergunta que falhou
      const msg = friendlyError(e);
      showAI(msg);
      setState("idle", IDLE_HINT);
      if (e && e.message !== "NO_KEY") speak(msg);
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------------
  // Microfone
  // ------------------------------------------------------------------
  function toggleMic() {
    if (state === "listening") {
      if (NATIVE) window.Android.stopListening();
      return;
    }
    if (busy) return;
    cancelPendingLaunch();
    stopSpeaking();
    showUser("");
    if (NATIVE) {
      window.Android.startListening();
    } else {
      // Teste no PC: digita a frase.
      const t = window.prompt("Fale (simulado) — digite o comando:");
      if (t && t.trim()) ask(t.trim());
    }
  }

  const STT_ERRORS = {
    no_match: "Não entendi. Tente de novo.",
    timeout: "Não ouvi nada. Pressione o microfone e fale.",
    network: "O reconhecimento de voz precisa de internet.",
    permission: "Preciso de permissão para usar o microfone.",
    unavailable: "Reconhecimento de voz indisponível nesta TV (instale/atualize o app Google).",
  };

  // ------------------------------------------------------------------
  // Eventos vindos do Android
  // ------------------------------------------------------------------
  window.onNativeEvent = function (type, payload) {
    switch (type) {
      case "mic_key": toggleMic(); break;
      case "stt_start": setState("listening", "Ouvindo…"); showAI("Pode falar…"); break;
      case "stt_partial": showUser(payload); break;
      case "stt_result": ask(payload); break;
      case "stt_error":
        setState("idle", IDLE_HINT);
        showAI(STT_ERRORS[payload] || "Erro no reconhecimento de voz.");
        break;
      case "tts_start": setState("speaking", ""); break;
      case "tts_end":
        if (state === "speaking") setState("idle", IDLE_HINT);
        if (pendingLaunch) {
          const p = pendingLaunch; cancelPendingLaunch();
          launchApp(p.package);
        }
        break;
      case "home":
      case "back":
        cancelPendingLaunch();
        stopSpeaking();
        showUser("");
        setState("idle", IDLE_HINT);
        el.apps.scrollLeft = 0;
        el.mic.focus();
        break;
      case "resume":
        loadApps();       // apps podem ter sido instalados/removidos
        updateNetwork();
        break;
    }
  };

  // ------------------------------------------------------------------
  // Navegação D-Pad
  // ------------------------------------------------------------------
  function tiles() { return Array.from(el.apps.querySelectorAll(".app-tile")); }

  document.addEventListener("keydown", (ev) => {
    const key = ev.key;
    const active = document.activeElement;
    const inApps = active && active.classList && active.classList.contains("app-tile");
    const list = tiles();

    if (key === "m" || key === "M") { toggleMic(); ev.preventDefault(); return; }

    if (key === "ArrowLeft" || key === "ArrowRight") {
      if (inApps) {
        const i = list.indexOf(active) + (key === "ArrowRight" ? 1 : -1);
        if (i >= 0 && i < list.length) { list[i].focus(); list[i].scrollIntoView({ inline: "center", block: "nearest" }); }
      }
      ev.preventDefault();
    } else if (key === "ArrowDown") {
      if (!inApps && list.length) { list[0].focus(); }
      ev.preventDefault();
    } else if (key === "ArrowUp") {
      if (inApps) el.mic.focus();
      ev.preventDefault();
    } else if (key === "Enter" || key === " " || ev.keyCode === 23) {
      if (inApps) {
        const a = apps[Number(active.dataset.index)];
        if (a) launchApp(a.package);
      } else {
        toggleMic();
      }
      ev.preventDefault();
    }
  });

  el.mic.addEventListener("click", toggleMic);

  // Garante que sempre exista algo com foco (a WebView perde foco ao voltar de outro app).
  window.addEventListener("focus", () => { if (!document.activeElement || document.activeElement === document.body) el.mic.focus(); });

  // ------------------------------------------------------------------
  // Inicialização
  // ------------------------------------------------------------------
  function init() {
    tickClock();
    setInterval(tickClock, 1000);
    updateNetwork();
    setInterval(updateNetwork, 8000);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);

    loadApps();
    el.mic.focus();
    setState("idle", IDLE_HINT);
    greet();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
