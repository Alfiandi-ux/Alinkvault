package com.alfiandi.alinkvault;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int REQ_FILE = 4201;
    private static final int REQ_SAVE = 4202;
    private static final int REQ_IMPORT = 4203;
    private static final String APP_ORIGIN = "appassets.androidplatform.net";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PendingSave pendingSave;

    private static final class PendingSave {
        final String filename;
        final String content;
        final String mimeType;

        PendingSave(String filename, String content, String mimeType) {
            this.filename = filename;
            this.content = content;
            this.mimeType = mimeType;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webview);

        applyNativeTheme(isSystemDark());
        setupWebView();
    }

    private boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyNativeTheme(boolean dark) {
        Window window = getWindow();
        int background = Color.parseColor(dark ? "#070A16" : "#E9EDFA");
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(background);
        window.setNavigationBarColor(background);
        if (webView != null) {
            webView.setBackgroundColor(background);
        }

        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " Alinkvault/1.0");
        // Render di luar layar & layer hardware: gulir lebih hemat di WebView.
        settings.setOffscreenPreRaster(true);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setBackgroundColor(Color.parseColor("#070A16"));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = serveAsset(request.getUrl());
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && APP_ORIGIN.equalsIgnoreCase(url.getHost())) {
                    return false;
                }
                if (url != null) {
                    openExternal(url);
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        webView.loadUrl("https://" + APP_ORIGIN + "/assets/index.html");
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (uri == null || !APP_ORIGIN.equalsIgnoreCase(uri.getHost())) return null;

        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/assets/index.html";
        }

        if (!path.startsWith("/assets/")) {
            return textResponse(404, "Not Found", "Aset tidak ditemukan");
        }

        String assetPath = path.substring("/assets/".length());
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");

        try {
            InputStream stream = getAssets().open(assetPath);
            return new WebResourceResponse(mimeType(assetPath), "UTF-8", 200, "OK", headers, stream);
        } catch (IOException e) {
            return textResponse(404, "Not Found", "Aset tidak ditemukan: " + assetPath);
        }
    }

    private WebResourceResponse textResponse(int code, String reason, String message) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "text/plain; charset=utf-8");
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            code,
            reason,
            headers,
            new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8))
        );
    }

    private String mimeType(String path) {
        String clean = path.toLowerCase(Locale.US);
        int dot = clean.lastIndexOf('.');
        String ext = dot >= 0 ? clean.substring(dot + 1) : "";
        switch (ext) {
            case "html": return "text/html";
            case "css": return "text/css";
            case "js": return "application/javascript";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
        }
    }

    private String safeFilename(String filename) {
        String name = filename == null ? "" : filename.trim();
        if (name.isEmpty()) name = "alinkvault-backup.json";
        return name.replaceAll("[\\\\/:*?\"<>|]", "-");
    }

    private String baseMime(String mimeType) {
        if (mimeType == null || mimeType.trim().isEmpty()) return "application/octet-stream";
        int semicolon = mimeType.indexOf(';');
        String base = semicolon >= 0 ? mimeType.substring(0, semicolon) : mimeType;
        return base.trim().isEmpty() ? "application/octet-stream" : base.trim();
    }

    private void startSave(String filename, String content, String mimeType) {
        String safeName = safeFilename(filename);
        pendingSave = new PendingSave(safeName, content == null ? "" : content, baseMime(mimeType));

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(pendingSave.mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, safeName);

        try {
            startActivityForResult(intent, REQ_SAVE);
        } catch (Exception e) {
            pendingSave = null;
            Toast.makeText(this, "Tidak bisa membuka penyimpan berkas.", Toast.LENGTH_LONG).show();
        }
    }

    private void startImport() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
            "application/json",
            "text/plain",
            "application/octet-stream"
        });
        try {
            startActivityForResult(intent, REQ_IMPORT);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak bisa membuka pemilih berkas.", Toast.LENGTH_LONG).show();
        }
    }

    private void readImport(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("Aliran berkas kosong");

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            int total = 0;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                if (total > 8 * 1024 * 1024) throw new IOException("Berkas terlalu besar (maks. 8 MB)");
                buffer.write(chunk, 0, read);
            }

            String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                text = text.substring(1);
            }
            final String payload = text;

            if (webView != null) {
                webView.post(() -> {
                    if (webView == null) return;
                    webView.evaluateJavascript(
                        "window.__alinkvaultImportText && window.__alinkvaultImportText("
                            + JSONObject.quote(payload) + ")",
                        null
                    );
                });
            }
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membaca berkas cadangan: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_IMPORT) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                readImport(data.getData());
            }
            return;
        }

        if (requestCode == REQ_FILE) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == REQ_SAVE) {
            PendingSave save = pendingSave;
            pendingSave = null;
            if (save == null || resultCode != RESULT_OK || data == null || data.getData() == null) {
                return;
            }
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                if (out == null) throw new IOException("Aliran keluaran kosong");
                out.write(save.content.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Berkas disimpan: " + save.filename, Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(this, "Gagal menyimpan berkas: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        final WebView view = webView;
        if (view == null) {
            finish();
            return;
        }
        view.evaluateJavascript(
            "(function(){try{return window.__alinkvaultBack?window.__alinkvaultBack():false;}catch(e){return false;}})()",
            value -> {
                if (!"true".equals(value)) {
                    if (view.canGoBack()) {
                        view.goBack();
                    } else {
                        finish();
                    }
                }
            }
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void downloadFile(String filename, String content, String mimeType) {
            runOnUiThread(() -> startSave(filename, content, mimeType));
        }

        @JavascriptInterface
        public void importBackup() {
            runOnUiThread(() -> startImport());
        }

        @JavascriptInterface
        public void setTheme(String theme) {
            runOnUiThread(() -> applyNativeTheme("dark".equals(theme)));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null) return;
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return;
            runOnUiThread(() -> openExternal(uri));
        }

        @JavascriptInterface
        public String getClipboard() {
            final String[] result = { "" };
            final CountDownLatch latch = new CountDownLatch(1);
            runOnUiThread(() -> {
                try {
                    ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (manager != null && manager.hasPrimaryClip()) {
                        ClipData clip = manager.getPrimaryClip();
                        if (clip != null && clip.getItemCount() > 0) {
                            CharSequence text = clip.getItemAt(0).coerceToText(MainActivity.this);
                            if (text != null) result[0] = text.toString();
                        }
                    }
                } catch (Exception ignored) {
                    // Clipboard bisa dibatasi oleh sistem.
                } finally {
                    latch.countDown();
                }
            });
            try {
                latch.await(1200, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            return result[0];
        }
    }
}
