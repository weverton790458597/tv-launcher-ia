# Gemini TV Launcher

Launcher para Android TV / Google TV: sem anúncios, abre rápido e conversa por voz usando o Google Gemini (Flash).

## Como compilar

1. Abra a pasta `android/` no **Android Studio** (ele baixa o Gradle e gera o wrapper sozinho).
2. Edite `config/config.js` e coloque sua chave em `GEMINI_API_KEY` (pegue em https://aistudio.google.com/apikey).
   Ajuste `GEMINI_MODEL` se quiser outro modelo Flash.
3. **Build > Build APK(s)** (ou `Run` direto na TV/emulador Android TV).

## Instalar na TV

```bash
adb connect IP_DA_TV:5555
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Ao apertar HOME, o Android pergunta qual tela inicial usar: escolha **Gemini Launcher** e "Sempre".
Em algumas TVs (Google TV recente) o sistema não deixa trocar a tela inicial pela interface; nesse caso:

```bash
# define como Home padrão (reversível)
adb shell cmd package set-home-activity com.weverton.tvlauncher/.MainActivity
```

Para voltar ao original: `adb shell cmd package set-home-activity <pacote do launcher original>`
(ex.: `com.google.android.tvlauncher`).

## Como usar

- **Botão de microfone do controle** (ou o botão "Falar" + OK): fale o comando.
- "Abra o YouTube", "quero ver a Netflix" → o Gemini devolve `{"action":"open_app","package":"..."}` e o app é aberto.
- Qualquer outra frase vira conversa curta, respondida em voz alta.
- D-Pad: ↑/↓ alternam entre o botão de voz e o carrossel; ←/→ percorrem os apps; OK abre.

## Estrutura

```
android/   projeto Android (manifest com CATEGORY_HOME, MainActivity.kt = ponte nativa)
assets/    interface web (index.html, style.css, app.js)
config/    config.js (chave e modelo do Gemini)
```

## Observações

- **Segurança da chave:** ela fica dentro do APK e pode ser extraída. Use uma chave dedicada, com restrição e cota baixa, e não distribua o APK.
- O reconhecimento de voz usa o serviço do Google já instalado na TV (precisa de internet). Se o controle não tiver botão de microfone, use o botão "Falar" na tela.
- A lista de apps instalados é enviada ao Gemini a cada pergunta, para ele mapear "Netflix" → pacote correto.
- Se o botão de microfone do seu controle abrir o Assistente do Google em vez do launcher, é o sistema interceptando a tecla; use o botão "Falar".
