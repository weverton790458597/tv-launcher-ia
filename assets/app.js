(function () {
  "use strict";

  const DEFAULT_MODEL = "gemini-3.8-flash";
  const FALLBACK_MODEL = "gemini-3.5-flash";  // reserva quando o modelo principal está sobrecarregado (503)   // gemini-1.5-flash foi desativado pelo Google (retorna 404)

  const CFG = Object.assign(
    { GEMINI_API_KEY: "", GEMINI_MODEL: DEFAULT_MODEL, USER_NAME: "", LOCALE: "pt-BR", MAX_HISTORY_TURNS: 8, VOICE: "" },
    window.CONFIG || {}
  );
  const NATIVE = typeof window.Android !== "undefined";
  const $ = (id) => document.getElementById(id);

  const el = {
    clock: $("clock"), date: $("date"), net: $("net"), netLabel: $("net-label"),
    orb: $("orb"), user: $("user-line"), ai: $("ai-line"), status: $("status"),
    mic: $("mic"), apps: $("apps"), gear: $("gear"),
    overlay: $("settings"), setKey: $("set-key"), setKeyToggle: $("set-key-toggle"),
    setModel: $("set-model"), setVoice: $("set-voice"), setName: $("set-name"), setMsg: $("set-msg"),
    setSave: $("set-save"), setTest: $("set-test"), setCancel: $("set-cancel"),
  };
  const BASE_CFG = Object.assign({}, CFG);

  let apps = [];
  let history = [];
  let state = "idle";
  let pendingLaunch = null;
  let busy = false;

  function setState(s, statusText) {
    state = s;
    el.orb.dataset.state = s;
    el.mic.classList.toggle("active", s === "listening");
    if (statusText !== undefined) el.status.textContent = statusText;
  }
  const IDLE_HINT = "Pressione o botão de microfone do controle ou o botão Falar";

  function showAI(text) { el.ai.textContent = text; }
  function showUser(text) { el.user.textContent = text ? "“" + text + "”" : ""; }

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

  // Carregar vozes na interface
  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    el.setVoice.innerHTML = '<option value="">Padrão do sistema</option>';
    voices.forEach((v) => {
      if (v.lang.includes("pt") || v.lang.includes("BR")) {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if (v.name === CFG.VOICE) opt.selected = true;
        el.setVoice.appendChild(opt);
      }
    });
  }

  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text) {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = CFG.LOCALE;
      
      const voices = speechSynthesis.getVoices();
      if (CFG.VOICE) {
        const selectedVoice = voices.find((v) => v.name === CFG.VOICE);
        if (selectedVoice) u.voice = selectedVoice;
      }

      u.onstart = () => window.onNativeEvent("tts_start", "");
      u.onend = () => window.onNativeEvent("tts_end", "");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else if (NATIVE) {
      try { window.Android.speak(text); return; } catch (e) {}
    } else {
      window.onNativeEvent("tts_end", "");
    }
  }

  function stopSpeaking() {
    if (NATIVE) { try { window.Android.stopSpeaking(); } catch (e) {} }
    else if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

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
      '2. Se o usuário pedir para abrir/ver/assistir algo que corresponda a um app da lista abaixo:',
      '   action="open_app" e package = EXATAMENTE o pacote da lista.',
      '3. Se o app pedido NÃO estiver na lista, use action="none" e avise que ele não está instalado.',
      "",
      "Apps instalados nesta TV:",
      appList,
    ].join("\n");
  }

  async function callGemini(contents, system, temperature) {
    if (!CFG.GEMINI_API_KEY || CFG.GEMINI_API_KEY.indexOf("COLE_") === 0) {
      throw new Error("NO_KEY");
    }
    
    // Garante que o modelo tenha o prefixo correto exigido pela API v1beta
    let rawModel = (CFG.GEMINI_MODEL || DEFAULT_MODEL).trim();
    if (rawModel.startsWith("models/")) {
        rawModel = rawModel.replace("models/", "");
    }
    
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 1024,   // folga para o "thinking" dos modelos Gemini 3 não cortar a resposta
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "low" },   // respostas rápidas para voz
      },
    };

    // Tenta o modelo escolhido (2x) e, se o servidor estiver sobrecarregado (503/500/502/504/429),
    // cai para o modelo reserva.
    const attempts = [rawModel, rawModel];
    if (rawModel !== FALLBACK_MODEL) attempts.push(FALLBACK_MODEL);
    const RETRYABLE = [429, 500, 502, 503, 504];

    let res = null;
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(attempts[i])}:generateContent?key=${encodeURIComponent(CFG.GEMINI_API_KEY)}`;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": CFG.GEMINI_API_KEY },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (r.ok) { res = r; break; }
        const err = new Error("HTTP_" + r.status);
        err.status = r.status;
        lastErr = err;
        if (RETRYABLE.indexOf(r.status) === -1) throw err;   // erro definitivo (400/403/404): não adianta repetir
      } catch (e) {
        if (e && e.status && RETRYABLE.indexOf(e.status) === -1) throw e;
        lastErr = e;
      } finally {
        clearTimeout(to);
      }
      if (i < attempts.length - 1) await new Promise((ok) => setTimeout(ok, 800));
    }
    if (!res) throw lastErr || new Error("FAILED");
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
      return { speech: t, action: "none", package: null };
    }
  }

  function friendlyError(e) {
    if (e && e.message === "NO_KEY") return "Falta a chave do Gemini. Configure na engrenagem.";
    if (e && e.name === "AbortError") return "O Gemini demorou demais para responder. Tente de novo.";
    if (e && (e.status === 400 || e.status === 403)) return "A chave do Gemini foi recusada. Verifique nas Configurações.";
    if (e && e.status === 404) return "Modelo não encontrado. Verifique o nome do modelo nas Configurações.";
    if (e && e.status === 503) return "O Gemini está sobrecarregado agora. Tente de novo em instantes.";
    if (e && e.status === 429) return "Muitos pedidos ao Gemini agora. Tente de novo em instantes.";
    if (!navigator.onLine) return "A TV está sem internet.";
    return "Não consegui falar com o Gemini agora.";
  }

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
          `que acabou de ligar a TV de ${periodo}. Termine perguntando o que vão fazer hoje. Máximo 15 palavras.` }] }],
        systemPrompt(), 1.0
      );
      const parsed = parseModelJson(raw);
      if (parsed.speech) text = parsed.speech;
    } catch (e) {
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
      const speech = r.speech || (r.action === "open_app" ? "Abrindo." : "Não entendi. Pode repetir?");
      history.push({ role: "model", text: speech });

      if (r.action === "open_app" && r.package) {
        const known = apps.find((a) => a.package === r.package);
        if (known || !NATIVE) {
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
      history.pop();
      const msg = friendlyError(e);
      showAI(msg);
      setState("idle", IDLE_HINT);
      if (e && e.message !== "NO_KEY") speak(msg);
    } finally {
      busy = false;
    }
  }

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
      const t = window.prompt("Fale (simulado) — digite o comando:");
      if (t && t.trim()) ask(t.trim());
    }
  }

  let settingsOpen = false;

  function storeGet(k) {
    try {
      if (NATIVE) return window.Android.getSetting(k) || "";
      return localStorage.getItem("gl_" + k) || "";
    } catch (e) { return ""; }
  }
  function storeSet(k, v) {
    try {
      if (NATIVE) window.Android.setSetting(k, v);
      else localStorage.setItem("gl_" + k, v);
      return true;
    } catch (e) { return false; }
  }

  function loadSettings() {
    CFG.GEMINI_API_KEY = storeGet("api_key") || BASE_CFG.GEMINI_API_KEY;
    // Migra modelos antigos/desativados que ficaram salvos no aparelho.
    const savedModel = storeGet("model");
    CFG.GEMINI_MODEL = (savedModel && !/^gemini-(1\.|2\.0)/.test(savedModel)) ? savedModel : DEFAULT_MODEL;
    CFG.USER_NAME = storeGet("user_name") || BASE_CFG.USER_NAME;
    CFG.VOICE = storeGet("voice") || "";
  }

  function hasKey() {
    const k = CFG.GEMINI_API_KEY;
    return !!k && k.indexOf("COLE_") !== 0;
  }

  function setMsg(text, kind) {
    el.setMsg.textContent = text;
    el.setMsg.className = "set-msg" + (kind ? " " + kind : "");
  }

  function openSettings(firstRun) {
    settingsOpen = true;
    cancelPendingLaunch();
    stopSpeaking();
    if (state === "listening" && NATIVE) { try { window.Android.stopListening(); } catch (e) {} }
    el.setKey.value = hasKey() ? CFG.GEMINI_API_KEY : "";
    el.setKey.type = "password";
    el.setKeyToggle.textContent = "Mostrar chave";
    el.setModel.value = CFG.GEMINI_MODEL || DEFAULT_MODEL;
    el.setName.value = CFG.USER_NAME || "";
    loadVoices();
    setMsg(firstRun ? "Digite ou cole sua chave do Gemini para começar." : "", "");
    el.overlay.hidden = false;
    el.setKey.focus();
  }

  function closeSettings() {
    settingsOpen = false;
    el.overlay.hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    loadSettings();
    el.gear.focus();
  }

  function saveSettings() {
    const key = el.setKey.value.trim().replace(/^["']|["']$/g, "");
    const ok = storeSet("api_key", key) &&
      storeSet("model", el.setModel.value.trim() || DEFAULT_MODEL) &&
      storeSet("user_name", el.setName.value.trim()) &&
      storeSet("voice", el.setVoice.value);
    if (!ok) { setMsg("Não consegui salvar. Tente de novo.", "err"); return; }
    closeSettings();
    if (hasKey()) greet();
    else { showAI("Chave removida. Configure uma nova para conversar."); setState("idle", IDLE_HINT); }
  }

  async function testSettings() {
    const key = el.setKey.value.trim().replace(/^["']|["']$/g, "");
    if (!key) { setMsg("Digite a chave primeiro.", "err"); return; }
    CFG.GEMINI_API_KEY = key;
    CFG.GEMINI_MODEL = el.setModel.value.trim() || DEFAULT_MODEL;
    setMsg("Testando…", "");
    try {
      await callGemini(
        [{ role: "user", parts: [{ text: "Responda apenas com o JSON: {\"speech\":\"ok\"}" }] }],
        "Responda sempre com JSON válido.", 0
      );
      setMsg("Chave válida ✓ — lembre de tocar em Salvar.", "ok");
    } catch (e) {
      setMsg(friendlyError(e), "err");
    }
  }

  function toggleKeyVisibility() {
    const show = el.setKey.type === "password";
    el.setKey.type = show ? "text" : "password";
    el.setKeyToggle.textContent = show ? "Ocultar chave" : "Mostrar chave";
  }

  function settingsKey(ev) {
    const rows = [[el.setKey], [el.setKeyToggle], [el.setModel], [el.setVoice], [el.setName],
                  [el.setSave, el.setTest, el.setCancel]];
    const active = document.activeElement;
    let r = rows.findIndex((row) => row.indexOf(active) !== -1);
    if (r === -1) { el.setKey.focus(); return; }
    const c = rows[r].indexOf(active);
    const isInput = active.tagName === "INPUT" || active.tagName === "SELECT";

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const nr = r + (ev.key === "ArrowDown" ? 1 : -1);
      if (nr >= 0 && nr < rows.length) rows[nr][Math.min(c, rows[nr].length - 1)].focus();
      ev.preventDefault();
    } else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !isInput) {
      const nc = c + (ev.key === "ArrowRight" ? 1 : -1);
      if (nc >= 0 && nc < rows[r].length) rows[r][nc].focus();
      ev.preventDefault();
    }
  }

  function bindSettings() {
    el.gear.addEventListener("click", () => openSettings(false));
    el.setSave.addEventListener("click", saveSettings);
    el.setTest.addEventListener("click", testSettings);
    el.setCancel.addEventListener("click", closeSettings);
    el.setKeyToggle.addEventListener("click", toggleKeyVisibility);
  }

  const STT_ERRORS = {
    no_match: "Não entendi. Tente de novo.",
    timeout: "Não ouvi nada. Pressione o microfone e fale.",
    network: "O reconhecimento de voz precisa de internet.",
    permission: "Preciso de permissão para usar o microfone.",
    unavailable: "Reconhecimento de voz indisponível nesta TV.",
  };

  window.onNativeEvent = function (type, payload) {
    switch (type) {
      case "mic_key": if (!settingsOpen) toggleMic(); break;
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
        if (settingsOpen) { closeSettings(); break; }
        cancelPendingLaunch();
        stopSpeaking();
        showUser("");
        setState("idle", IDLE_HINT);
        el.apps.scrollLeft = 0;
        el.mic.focus();
        break;
      case "resume":
        loadApps();
        updateNetwork();
        break;
    }
  };

  function tiles() { return Array.from(el.apps.querySelectorAll(".app-tile")); }

  document.addEventListener("keydown", (ev) => {
    const key = ev.key;
    const active = document.activeElement;
    const inApps = active && active.classList && active.classList.contains("app-tile");
    const list = tiles();

    if (settingsOpen) {
      if (key === "Escape") { closeSettings(); ev.preventDefault(); return; }
      settingsKey(ev);
      return;
    }

    if (key === "m" || key === "M") { toggleMic(); ev.preventDefault(); return; }

    if (key === "ArrowLeft" || key === "ArrowRight") {
      if (inApps) {
        const i = list.indexOf(active) + (key === "ArrowRight" ? 1 : -1);
        if (i >= 0 && i < list.length) { list[i].focus(); list[i].scrollIntoView({ inline: "center", block: "nearest" }); }
      }
      ev.preventDefault();
    } else if (key === "ArrowDown") {
      if (active === el.gear) el.mic.focus();
      else if (!inApps && list.length) { list[0].focus(); }
      ev.preventDefault();
    } else if (key === "ArrowUp") {
      if (inApps) el.mic.focus();
      else if (active === el.mic) el.gear.focus();
      ev.preventDefault();
    } else if (key === "Enter" || key === " " || ev.keyCode === 23) {
      if (inApps) {
        const a = apps[Number(active.dataset.index)];
        if (a) launchApp(a.package);
      } else if (active === el.gear) {
        openSettings(false);
      } else {
        toggleMic();
      }
      ev.preventDefault();
    }
  });

  el.mic.addEventListener("click", toggleMic);
  window.addEventListener("focus", () => { if (!document.activeElement || document.activeElement === document.body) el.mic.focus(); });

  function init() {
    loadSettings();
    bindSettings();
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
    if (!hasKey()) openSettings(true);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
