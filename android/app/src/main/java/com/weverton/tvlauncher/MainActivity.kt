package com.weverton.tvlauncher

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.view.KeyEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.Locale

/**
 * Launcher de TV: hospeda a interface web (assets/) em uma WebView e expõe
 * ao JavaScript a ponte nativa: apps instalados, abrir app, STT, TTS e rede.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var startListeningAfterPermission = false

    companion object {
        private const val REQ_AUDIO = 101
        private const val LOCALE_TAG = "pt-BR"
    }

    // ------------------------------------------------------------------
    // Ciclo de vida
    // ------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)
        hideSystemBars()

        // Serve /assets via https://appassets.androidplatform.net/ (origem https válida
        // para fetch() à API do Gemini, sem os problemas de CORS do file://).
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.apply {
            setBackgroundColor(0xFF070A14.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            isFocusable = true
            isFocusableInTouchMode = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(NativeBridge(), "Android")
            loadUrl("https://appassets.androidplatform.net/assets/index.html")
            requestFocus()
        }

        initTts()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // HOME pressionado de novo: volta ao estado inicial da interface.
        if (intent?.hasCategory(Intent.CATEGORY_HOME) == true) {
            stopListeningInternal()
            tts?.stop()
            sendEvent("home", "")
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        sendEvent("resume", "")
    }

    override fun onPause() {
        super.onPause()
        stopListeningInternal()
        tts?.stop()
    }

    override fun onDestroy() {
        recognizer?.destroy()
        tts?.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    // HOME é o launcher: BACK não deve fechar nada.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        sendEvent("back", "")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Botão de microfone / Assistente do controle remoto.
        if (keyCode == KeyEvent.KEYCODE_SEARCH ||
            keyCode == KeyEvent.KEYCODE_VOICE_ASSIST ||
            keyCode == KeyEvent.KEYCODE_ASSIST
        ) {
            if (event?.repeatCount == 0) sendEvent("mic_key", "")
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun hideSystemBars() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
    }

    // ------------------------------------------------------------------
    // Eventos Nativo -> JS   (window.onNativeEvent(type, payload))
    // ------------------------------------------------------------------

    private fun sendEvent(type: String, payload: String) {
        val js = "window.onNativeEvent && window.onNativeEvent(" +
            JSONObject.quote(type) + "," + JSONObject.quote(payload) + ");"
        runOnUiThread { if (::webView.isInitialized) webView.evaluateJavascript(js, null) }
    }

    // ------------------------------------------------------------------
    // Text-to-Speech
    // ------------------------------------------------------------------

    private fun initTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val engine = tts ?: return@TextToSpeech
                val r = engine.setLanguage(Locale.forLanguageTag(LOCALE_TAG))
                ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
                engine.setSpeechRate(1.0f)
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = sendEvent("tts_start", "")
                    override fun onDone(utteranceId: String?) = sendEvent("tts_end", "")
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) = sendEvent("tts_end", "")
                })
                pendingSpeech?.let { speakInternal(it) }
                pendingSpeech = null
            }
        }
    }

    private fun speakInternal(text: String) {
        if (!ttsReady) {
            pendingSpeech = text
            return
        }
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "utt-" + System.currentTimeMillis())
    }

    // ------------------------------------------------------------------
    // Speech-to-Text
    // ------------------------------------------------------------------

    private fun startListeningInternal() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startListeningAfterPermission = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            sendEvent("stt_error", "unavailable")
            return
        }
        tts?.stop()
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    listening = true
                    sendEvent("stt_start", "")
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    val t = partialResults
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull().orEmpty()
                    if (t.isNotBlank()) sendEvent("stt_partial", t)
                }
                override fun onResults(results: Bundle?) {
                    listening = false
                    val t = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull().orEmpty()
                    if (t.isBlank()) sendEvent("stt_error", "no_match") else sendEvent("stt_result", t)
                }
                override fun onError(error: Int) {
                    listening = false
                    val code = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "timeout"
                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
                        else -> "error_$error"
                    }
                    sendEvent("stt_error", code)
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, LOCALE_TAG)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        recognizer?.startListening(intent)
    }

    private fun stopListeningInternal() {
        if (listening) {
            recognizer?.stopListening()
            listening = false
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_AUDIO) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            if (granted && startListeningAfterPermission) startListeningInternal()
            else if (!granted) sendEvent("stt_error", "permission")
            startListeningAfterPermission = false
        }
    }

    // ------------------------------------------------------------------
    // Apps instalados
    // ------------------------------------------------------------------

    private fun drawableToPng64(d: Drawable): String {
        val size = 128
        val bmp = if (d is BitmapDrawable && d.bitmap != null) {
            Bitmap.createScaledBitmap(d.bitmap, size, size, true)
        } else {
            val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            d.setBounds(0, 0, size, size)
            d.draw(c)
            b
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 90, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    private fun listInstalledApps(): String {
        val pm = packageManager
        fun query(category: String) = pm.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(category), 0
        )

        // Prioriza apps de TV (leanback); completa com os apps de celular/tablet.
        val resolved = LinkedHashMap<String, android.content.pm.ResolveInfo>()
        (query(Intent.CATEGORY_LEANBACK_LAUNCHER) + query(Intent.CATEGORY_LAUNCHER)).forEach { ri ->
            val pkg = ri.activityInfo.packageName
            if (pkg != packageName && !resolved.containsKey(pkg)) resolved[pkg] = ri
        }

        val arr = JSONArray()
        resolved.values
            .sortedBy { it.loadLabel(pm).toString().lowercase(Locale.ROOT) }
            .forEach { ri ->
                val icon = try {
                    // Banner de TV (16:9) se existir, senão o ícone normal.
                    drawableToPng64(ri.activityInfo.loadBanner(pm) ?: ri.loadIcon(pm))
                } catch (e: Exception) {
                    ""
                }
                arr.put(
                    JSONObject()
                        .put("name", ri.loadLabel(pm).toString())
                        .put("package", ri.activityInfo.packageName)
                        .put("icon", icon)
                )
            }
        return arr.toString()
    }

    private fun openAppInternal(pkg: String): Boolean {
        val pm = packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
        return if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                startActivity(intent)
                true
            } catch (e: Exception) {
                false
            }
        } else false
    }

    private fun networkType(): String {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> "other"
            else -> "none"
        }
    }

    // ------------------------------------------------------------------
    // Ponte JS -> Nativo   (window.Android.*)
    // ------------------------------------------------------------------

    inner class NativeBridge {
        @JavascriptInterface fun getApps(): String = listInstalledApps()
        @JavascriptInterface fun openApp(pkg: String): Boolean = openAppInternal(pkg)
        @JavascriptInterface fun getNetwork(): String = networkType()
        @JavascriptInterface fun speak(text: String) { runOnUiThread { speakInternal(text) } }
        @JavascriptInterface fun stopSpeaking() { runOnUiThread { tts?.stop() } }
        @JavascriptInterface fun startListening() { runOnUiThread { startListeningInternal() } }
        @JavascriptInterface fun stopListening() { runOnUiThread { stopListeningInternal() } }
        @JavascriptInterface fun isListening(): Boolean = listening
    }
}
