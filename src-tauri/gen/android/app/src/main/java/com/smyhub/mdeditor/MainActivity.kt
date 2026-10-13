package com.smyhub.mdeditor

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView

class MainActivity : TauriActivity() {
    companion object {
        @JvmStatic var pendingFileUri: String? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Do NOT call enableEdgeToEdge(): it causes the system status bar to overlap
        // the app toolbar, making top buttons inaccessible.
        super.onCreate(savedInstanceState)
        handleFileIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleFileIntent(intent)
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        // Expose a JS interface so React can pull the pending file URI on startup
        webView.addJavascriptInterface(object : Any() {
            @JavascriptInterface
            fun getPendingFile(): String? {
                val uri = pendingFileUri
                pendingFileUri = null
                return uri
            }
        }, "__FileOpener__")
    }

    private fun handleFileIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW && intent.data != null) {
            pendingFileUri = intent.data.toString()
        }
    }
}
