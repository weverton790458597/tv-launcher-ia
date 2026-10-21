// Configuração do launcher. Este arquivo é empacotado dentro do APK.
//
// ATENÇÃO: uma chave de API embutida no APK pode ser extraída por quem tiver o arquivo.
// Use uma chave exclusiva para este app, restrita no Google AI Studio / Cloud Console,
// com cota baixa, e não distribua o APK publicamente.

window.CONFIG = {
  GEMINI_API_KEY: "COLE_SUA_CHAVE_AQUI",
  GEMINI_MODEL: "gemini-2.5-flash",   // qualquer modelo "Flash" disponível na sua conta
  USER_NAME: "Weverton",
  LOCALE: "pt-BR",
  MAX_HISTORY_TURNS: 8                // quantas trocas anteriores o Gemini lembra
};
