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
    mic: $("mic"), micLabel: $("mic-label"), apps: $("apps"), gear: $("gear"),
    overlay: $("settings"), setKey: $("set-key"), setKeyToggle: $("set-key-toggle"),
    setModel: $("set-model"), setVoice: $("set-voice"), setName: $("set-name"), setMsg: $("set-msg"),
    setSave: $("set-save"), setTest: $("set-test"), setCancel: $("set-cancel"), setEngine: $("set-engine"), setServer: $("set-server"), setServerBox: $("set-server-box"), setVoiceTest: $("set-voice-test"),
  };
  const BASE_CFG = Object.assign({}, CFG);

  let apps = [];
  let history = [];
  let state = "idle";
  let pendingLaunch = null;
  let busy = false;
  let convo = false, silentTurns = 0, streamCtl = null;
  const TTS_MODEL = (window.CONFIG && window.CONFIG.TTS_MODEL) || "gemini-2.5-flash-preview-tts";
  const GEMINI_VOICES = [["Kore","Kore — firme"],["Puck","Puck — animada"],["Zephyr","Zephyr — brilhante"],["Charon","Charon — informativa"],["Fenrir","Fenrir — empolgada"],["Leda","Leda — jovem"],["Orus","Orus — firme"],["Aoede","Aoede — leve"],["Callirrhoe","Callirrhoe — tranquila"],["Autonoe","Autonoe — brilhante"],["Enceladus","Enceladus — suave"],["Iapetus","Iapetus — clara"],["Umbriel","Umbriel — descontraída"],["Algieba","Algieba — suave"],["Despina","Despina — suave"],["Erinome","Erinome — clara"],["Algenib","Algenib — grave"],["Rasalgethi","Rasalgethi — informativa"],["Laomedeia","Laomedeia — animada"],["Achernar","Achernar — suave"],["Alnilam","Alnilam — firme"],["Schedar","Schedar — equilibrada"],["Gacrux","Gacrux — madura"],["Pulcherrima","Pulcherrima — direta"],["Achird","Achird — amigável"],["Zubenelgenubi","Zubenelgenubi — casual"],["Vindemiatrix","Vindemiatrix — gentil"],["Sadachbia","Sadachbia — vívida"],["Sadaltager","Sadaltager — culta"],["Sulafat","Sulafat — calorosa"]];

  function setState(s, statusText) {
    state = s;
    el.orb.dataset.state = s;
    document.body.dataset.state = s;
    el.micLabel.textContent = s === "listening" ? "Ouvindo…" : convo ? "Encerrar" : "Falar";
    el.mic.classList.toggle("active", s === "listening");
    if (statusText !== undefined) el.status.textContent = statusText;
  }
  const IDLE_HINT = "Pressione o botão de microfone do controle ou o botão Falar";

  function showAI(text, still) {
    el.ai.textContent = text;
    const n = (text || "").length;   // textos longos diminuem a fonte para caber no cartão
    el.ai.className = "ai-line" + (n > 260 ? " l2" : n > 130 ? " l1" : "");
    if (!still) { void el.ai.offsetWidth; el.ai.classList.add("swap"); }
  }
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

  // Aceita URL, caminho ou base64 "puro" (sem data:) vindo do app nativo
  function iconSrc(v) {
    const t = String(v).trim();
    if (/^(data:|https?:|file:|content:)/i.test(t) || t.length < 300) return t;
    return "data:image/png;base64," + t.replace(/\s/g, "");
  }

  function renderApps() {
    el.apps.textContent = "";
    if (!apps.length) {
      const d = document.createElement("div");
      d.className = "apps-empty";
      d.textContent = "Nenhum app encontrado.";
      el.apps.appendChild(d);
      return;
    }
    apps.forEach((a, i) => {
      const tile = document.createElement("div");
      tile.className = "app-tile";
      tile.tabIndex = 0;
      tile.setAttribute("role", "listitem");
      tile.dataset.row = "apps";
      tile.dataset.index = String(i);
      tile.style.setProperty("--i", String(Math.min(i, 12)));

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      if (a.icon) {
        const img = document.createElement("img");
        img.className = "ic";
        img.onload = () => { if (img.naturalHeight && img.naturalWidth / img.naturalHeight > 1.4) thumb.classList.add("banner"); };
        img.src = iconSrc(a.icon);
        img.alt = "";
        img.decoding = "async";
        img.onerror = () => { img.remove(); thumb.textContent = (a.name || "?").charAt(0).toUpperCase(); };
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

  let voiceListToken = 0;
  async function populateVoices(engine, server, selected) {
    const tk = ++voiceListToken;
    const fill = (items) => {
      if (tk !== voiceListToken) return;
      el.setVoice.textContent = "";
      items.forEach(([v, n]) => {
        const o = document.createElement("option");
        o.value = v; o.textContent = n; if (v === selected) o.selected = true;
        el.setVoice.appendChild(o);
      });
    };
    if (engine === "gemini") return fill(GEMINI_VOICES);
    if (engine === "edge") {
      if (!server) return fill([["", "Informe o endereço do servidor"]]);
      fill([["", "Carregando vozes…"]]);
      try {
        const r = await fetch(server.replace(/\/+$/, "") + "/vozes");
        const list = await r.json();
        fill(list.map((v) => [v.id, v.nome]));
        setMsg("", "");
      } catch (e) {
        fill([["", "Servidor inacessível"]]);
        setMsg("Não consegui acessar o servidor Edge TTS. Confira o endereço e se o PC está ligado.", "err");
      }
      return;
    }
    const vs = "speechSynthesis" in window ? speechSynthesis.getVoices().filter((v) => /pt/i.test(v.lang)) : [];
    fill([["", "Padrão do sistema"]].concat(vs.map((v) => [v.name, v.name + " (" + v.lang + ")"])));
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = () => { if (settingsOpen && el.setEngine.value === "system") populateVoices("system", "", CFG.VOICES.system); };
  }

  // Fila de fala: cada frase é sintetizada em paralelo e tocada em ordem.
  const sp = { token: 0, q: [], playing: false, started: false, finished: false, ended: false, release: null, nativeRes: null, src: null, audio: null, fresh: false };
  let actx = null;

  function unlockAudio() {
    try {
      if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
      if (actx && actx.state === "suspended") actx.resume();
    } catch (e) {}
  }
  const GL = "https://generativelanguage.googleapis.com/v1beta/models/";

  async function synthGemini(text) {
    const r = await fetch(GL + encodeURIComponent(TTS_MODEL) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": CFG.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CFG.VOICES.gemini || "Kore" } } } },
      }),
    });
    if (!r.ok) throw new Error("HTTP_" + r.status);
    const d = await r.json();
    const part = d.candidates[0].content.parts.find((p) => p.inlineData);
    return part.inlineData.data;   // PCM 16-bit, 24 kHz, mono (base64)
  }
  async function synthEdge(text) {
    const url = CFG.SERVER.replace(/\/+$/, "") + "/tts?voz=" + encodeURIComponent(CFG.VOICES.edge || "pt-BR-FranciscaNeural") + "&texto=" + encodeURIComponent(text);
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP_" + r.status);
    return URL.createObjectURL(await r.blob());
  }

  function playPcm(b64) {
    return new Promise((res) => {
      unlockAudio();
      const bin = atob(b64), n = bin.length >> 1;
      const buf = actx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v & 0x8000) v -= 0x10000; ch[i] = v / 32768; }
      const src = actx.createBufferSource();
      src.buffer = buf; src.connect(actx.destination);
      src.onended = () => res();
      sp.src = src; sp.release = res;
      src.start();
    });
  }
  function playUrl(url) {
    return new Promise((res) => {
      const a = new Audio(url);
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); res(); };
      sp.audio = a; sp.release = res;
      a.play().catch(() => res());
    });
  }
  function playSystem(text) {
    return new Promise((res) => {
      sp.release = res;
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = CFG.LOCALE;
        const v = CFG.VOICES.system && speechSynthesis.getVoices().find((x) => x.name === CFG.VOICES.system);
        if (v) u.voice = v;
        u.onend = u.onerror = () => res();
        const d = sp.fresh ? 80 : 0; sp.fresh = false;   // cancel() seguido de speak() imediato perde a fala em alguns WebViews
        setTimeout(() => speechSynthesis.speak(u), d);
      } else if (NATIVE) {
        sp.nativeRes = res;
        try { window.Android.speak(text); } catch (e) { res(); }
      } else res();
    });
  }

  async function playItem(item, t) {
    if (item.p) {
      try {
        const data = await item.p;
        if (t !== sp.token) return;
        if (data) { await (CFG.ENGINE === "gemini" ? playPcm(data) : playUrl(data)); return; }
      } catch (e) {}
      if (t !== sp.token) return;
    }
    await playSystem(item.text);   // reserva: se o motor escolhido falhar, usa a voz do sistema
  }

  async function pump() {
    if (sp.playing) return;
    const t = sp.token, item = sp.q.shift();
    if (!item) {
      if (sp.finished && !sp.ended) { sp.ended = true; speechDone(); }
      return;
    }
    sp.playing = true;
    if (!sp.started) { sp.started = true; setState("speaking", ""); }
    try { await playItem(item, t); } catch (e) {}
    if (t !== sp.token) return;
    sp.playing = false;
    pump();
  }

  function speechStop() {
    sp.token++; sp.q = []; sp.playing = false; sp.fresh = true;
    try { if (sp.src) sp.src.stop(); } catch (e) {}
    try { if (sp.audio) sp.audio.pause(); } catch (e) {}
    sp.src = sp.audio = null;
    const r = sp.release; sp.release = null; sp.nativeRes = null;
    if (r) r();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (NATIVE) { try { window.Android.stopSpeaking(); } catch (e) {} }
  }
  function speechBegin() { speechStop(); sp.started = sp.finished = sp.ended = false; }
  function enqueue(text) {
    const item = { text, p: null };
    if (CFG.ENGINE === "gemini" && actx) item.p = synthGemini(text);
    else if (CFG.ENGINE === "edge" && CFG.SERVER) item.p = synthEdge(text);
    if (item.p) item.p.catch(() => {});
    sp.q.push(item);
    pump();
  }
  function ttsFinish() { sp.finished = true; pump(); }
  function speak(text) { speechBegin(); enqueue(text); ttsFinish(); }

  function stopSpeaking() {
    if (streamCtl) { try { streamCtl.abort(); } catch (e) {} }
    speechStop();
    if (state === "speaking") setState("idle", IDLE_HINT);
  }

  // Fim da fala: abre app pendente ou volta a ouvir (conversa contínua)
  function speechDone() {
    if (state !== "listening") setState("idle", IDLE_HINT);
    if (pendingLaunch) { const p = pendingLaunch; cancelPendingLaunch(); convo = false; setState(state); launchApp(p.package); return; }
    if (convo && NATIVE && !settingsOpen) setTimeout(() => { if (convo && state === "idle" && !busy) startListen(); }, 300);
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

  function streamPrompt() {
    const appList = apps.slice(0, 150).map((a) => `- ${a.name} => ${a.package}`).join("\n") || "(nenhum)";
    return [
      `Você é o assistente de voz da Smart TV de ${CFG.USER_NAME || "o usuário"}. Responda sempre em português do Brasil.`,
      `Data e hora atuais: ${new Date().toLocaleString(CFG.LOCALE)}.`,
      "Suas respostas são LIDAS EM VOZ ALTA: no máximo 2 frases curtas, texto simples, sem markdown, listas, emojis ou URLs.",
      "Se o usuário pedir para abrir/ver/assistir algo que corresponda a um app da lista, diga uma frase curta e termine com a marca [[ABRIR:pacote.exato]] copiando o pacote da lista.",
      "Se o app não estiver na lista, avise que não está instalado e NÃO use a marca.",
      "",
      "Apps instalados nesta TV:",
      appList,
    ].join("\n");
  }

  async function streamGemini(contents, system, onText) {
    if (!hasKey()) throw new Error("NO_KEY");
    const m = (CFG.GEMINI_MODEL || DEFAULT_MODEL).trim().replace(/^models\//, "");
    const body = { systemInstruction: { parts: [{ text: system }] }, contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "low" } } };
    const models = m === FALLBACK_MODEL ? [m] : [m, FALLBACK_MODEL];
    let lastErr = null;
    for (const mod of models) {
      const ctrl = new AbortController(); streamCtl = ctrl;
      const to = setTimeout(() => ctrl.abort(), 25000);
      let got = false;
      try {
        const r = await fetch(GL + encodeURIComponent(mod) + ":streamGenerateContent?alt=sse", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": CFG.GEMINI_API_KEY },
          body: JSON.stringify(body), signal: ctrl.signal });
        if (!r.ok) { const e = new Error("HTTP_" + r.status); e.status = r.status; throw e; }
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = "", acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (line.indexOf("data:") !== 0) continue;
            try {
              const d = JSON.parse(line.slice(5));
              const ps = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
              const t = ps ? ps.map((p) => p.text || "").join("") : "";
              if (t) { acc += t; got = true; onText(acc); }
            } catch (e) {}
          }
        }
        if (!acc) throw new Error("EMPTY");
        return acc;
      } catch (e) {
        lastErr = e;
        if (got || (e.status && [429, 500, 502, 503, 504].indexOf(e.status) === -1) || e.name === "AbortError") throw e;
      } finally { clearTimeout(to); if (streamCtl === ctrl) streamCtl = null; }
    }
    throw lastErr || new Error("FAILED");
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

  const TAG_RE = /\[\[ABRIR:\s*([^\]\s]+)\s*\]\]/i;
  function stripTag(t) { return t.replace(/\[\[ABRIR:[^\]]*\]\]/gi, "").replace(/\[\[[^\]]*\]?$/, "").trim(); }

  async function ask(userText) {
    if (busy) return;
    busy = true;
    showUser(userText);
    setState("thinking", "Pensando…");
    history.push({ role: "user", text: userText });
    const maxMsgs = CFG.MAX_HISTORY_TURNS * 2;
    if (history.length > maxMsgs) history = history.slice(-maxMsgs);

    unlockAudio();
    speechBegin();
    const tok = sp.token;
    let spoken = 0;
    // Fala frase a frase enquanto o texto ainda está chegando
    const flush = (clean, final) => {
      for (;;) {
        const m = clean.slice(spoken).match(final ? /^\s*([\s\S]*?[.!?…]+["”')\]]*)(?=\s|$)/ : /^\s*([\s\S]*?[.!?…]+["”')\]]*)(?=\s)/);
        if (!m) break;
        enqueue(m[1].trim()); spoken += m[0].length;
      }
      if (final) { const r = clean.slice(spoken).trim(); if (r) enqueue(r); spoken = clean.length; }
    };

    try {
      const raw = await streamGemini(
        history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })), streamPrompt(),
        (acc) => { if (sp.token !== tok) return; const c = stripTag(acc); showAI(c || "…", true); flush(c, false); });
      if (sp.token !== tok) { history.pop(); return; }
      const clean = stripTag(raw), tag = raw.match(TAG_RE);
      flush(clean, true);
      let speech = clean;
      if (!speech) { speech = tag ? "Abrindo." : "Não entendi. Pode repetir?"; showAI(speech); enqueue(speech); }
      history.push({ role: "model", text: speech });
      if (tag) {
        if (apps.find((a) => a.package === tag[1]) || !NATIVE) {
          cancelPendingLaunch();
          pendingLaunch = { package: tag[1], timer: setTimeout(() => { const p = pendingLaunch; pendingLaunch = null; if (p) launchApp(p.package); }, 9000) };
        } else { showAI("Não encontrei esse app instalado na TV."); enqueue("Não encontrei esse app instalado na TV."); }
      }
      ttsFinish();
    } catch (e) {
      history.pop();
      if (sp.token !== tok) return;   // cancelado pelo usuário
      convo = false;
      const msg = friendlyError(e);
      showAI(msg);
      setState("idle", IDLE_HINT);
      if (e && e.message !== "NO_KEY") speak(msg);
    } finally {
      busy = false;
    }
  }

  function startListen() {
    cancelPendingLaunch();
    speechStop();
    showUser("");
    if (NATIVE) { window.Android.startListening(); return; }
    convo = false; setState(state);
    const t = window.prompt("Fale (simulado) — digite o comando:");
    if (t && t.trim()) ask(t.trim());
  }

  function endConvo() {
    convo = false;
    cancelPendingLaunch();
    stopSpeaking();
    setState("idle", IDLE_HINT);
  }

  // Um toque inicia a conversa contínua; outro toque encerra
  function toggleMic() {
    unlockAudio();
    if (state === "listening") {
      convo = false;
      if (NATIVE) { try { window.Android.stopListening(); } catch (e) {} }
      setState("idle", IDLE_HINT);
      return;
    }
    if (convo) { endConvo(); return; }
    if (busy) return;
    convo = true; silentTurns = 0;
    setState(state);
    startListen();
  }

  function handleUtterance(text) {
    if (/^(tchau|até logo|até mais|encerrar|pode parar|parar conversa)/i.test(text.trim())) {
      convo = false; showUser(text); say("Até logo!"); return;
    }
    ask(text);
  }

  function sttError(p) {
    const quiet = p === "no_match" || p === "timeout";
    if (convo && quiet && ++silentTurns < 2) {
      setTimeout(() => { if (convo && state !== "listening" && !busy) startListen(); }, 300);
      return;
    }
    const wasConvo = convo;
    convo = false;
    setState("idle", IDLE_HINT);
    showAI(wasConvo && quiet ? "Conversa encerrada por inatividade." : (STT_ERRORS[p] || "Erro no reconhecimento de voz."));
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
    CFG.ENGINE = storeGet("tts_engine") || "system";
    CFG.SERVER = storeGet("tts_server") || "";
    CFG.VOICES = { system: storeGet("voice_system") || storeGet("voice"), gemini: storeGet("voice_gemini"), edge: storeGet("voice_edge") };
  }

  function hasKey() {
    const k = CFG.GEMINI_API_KEY;
    return !!k && k.indexOf("COLE_") !== 0;
  }

  function setMsg(text, kind) {
    el.setMsg.textContent = text;
    el.setMsg.className = "set-msg" + (kind ? " " + kind : "");
  }

  function engineChanged() {
    const eng = el.setEngine.value;
    el.setServerBox.hidden = eng !== "edge";
    populateVoices(eng, el.setServer.value.trim(), CFG.VOICES[eng]);
  }

  function openSettings(firstRun) {
    settingsOpen = true;
    convo = false;
    cancelPendingLaunch();
    stopSpeaking();
    if (state === "listening" && NATIVE) { try { window.Android.stopListening(); } catch (e) {} }
    setState("idle", IDLE_HINT);
    el.setKey.value = hasKey() ? CFG.GEMINI_API_KEY : "";
    el.setKey.type = "password";
    el.setKeyToggle.textContent = "Mostrar chave";
    el.setModel.value = CFG.GEMINI_MODEL || DEFAULT_MODEL;
    el.setName.value = CFG.USER_NAME || "";
    el.setEngine.value = CFG.ENGINE;
    el.setServer.value = CFG.SERVER;
    setMsg(firstRun ? "Digite ou cole sua chave do Gemini para começar." : "", "");
    el.overlay.hidden = false;
    engineChanged();
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
    const eng = el.setEngine.value;
    const ok = storeSet("api_key", key) &&
      storeSet("model", el.setModel.value.trim() || DEFAULT_MODEL) &&
      storeSet("user_name", el.setName.value.trim()) &&
      storeSet("tts_engine", eng) &&
      storeSet("tts_server", el.setServer.value.trim()) &&
      storeSet("voice_" + eng, el.setVoice.value);
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

  // Toca uma amostra com os valores que estão na tela (sem precisar salvar)
  function testVoice() {
    const eng = el.setEngine.value;
    const key = el.setKey.value.trim().replace(/^["']|["']$/g, "");
    if (key) CFG.GEMINI_API_KEY = key;
    CFG.ENGINE = eng;
    CFG.SERVER = el.setServer.value.trim();
    CFG.VOICES[eng] = el.setVoice.value;
    unlockAudio();
    if (eng === "gemini" && !hasKey()) { setMsg("Digite a chave do Gemini para ouvir as vozes neurais.", "err"); return; }
    setMsg("Reproduzindo…", "");
    speak("Olá! Esta é a minha voz. Posso conversar com você na TV.");
  }

  function toggleKeyVisibility() {
    const show = el.setKey.type === "password";
    el.setKey.type = show ? "text" : "password";
    el.setKeyToggle.textContent = show ? "Ocultar chave" : "Mostrar chave";
  }

  function settingsKey(ev) {
    const rows = [[el.setKey], [el.setKeyToggle], [el.setModel], [el.setEngine], [el.setServer], [el.setVoice], [el.setName],
                  [el.setSave, el.setTest, el.setVoiceTest, el.setCancel]]
      .map((r) => r.filter((x) => x.offsetParent !== null)).filter((r) => r.length);
    const active = document.activeElement;
    const r = rows.findIndex((row) => row.indexOf(active) !== -1);
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
    el.setVoiceTest.addEventListener("click", testVoice);
    el.setCancel.addEventListener("click", closeSettings);
    el.setKeyToggle.addEventListener("click", toggleKeyVisibility);
    el.setEngine.addEventListener("change", engineChanged);
    el.setServer.addEventListener("change", () => { if (el.setEngine.value === "edge") engineChanged(); });
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
      case "stt_start": setState("listening", convo ? "Ouvindo… (conversa contínua)" : "Ouvindo…"); showAI("Pode falar…"); break;
      case "stt_partial": showUser(payload); break;
      case "stt_result": silentTurns = 0; handleUtterance(payload); break;
      case "stt_error": sttError(payload); break;
      case "tts_end": if (sp.nativeRes) { const r = sp.nativeRes; sp.nativeRes = null; r(); } break;   // fim do Android.speak
      case "home":
      case "back":
        if (settingsOpen) { closeSettings(); break; }
        convo = false;
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

  // Foca sem o navegador rolar a página e centraliza o item suavemente no carrossel
  function focusTile(t) {
    t.focus({ preventScroll: true });
    const c = el.apps;
    c.scrollTo({ left: Math.max(0, t.offsetLeft - (c.clientWidth - t.offsetWidth) / 2), behavior: "smooth" });
  }

  function tiles() { return Array.from(el.apps.querySelectorAll(".app-tile")); }

  document.addEventListener("keydown", (ev) => {
    const key = ev.key;
    unlockAudio();
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
        if (i >= 0 && i < list.length) focusTile(list[i]);
      }
      ev.preventDefault();
    } else if (key === "ArrowDown") {
      if (active === el.gear) el.mic.focus();
      else if (!inApps && list.length) { focusTile(list[0]); }
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
