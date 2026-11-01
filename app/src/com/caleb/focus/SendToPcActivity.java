package com.caleb.focus;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;

/**
 * No screen of its own. Handles "Share → Send to PC" and the "Clipboard to PC" quick setting.
 * The clipboard can only be read while an app has focus, so it waits for focus before reading.
 */
public class SendToPcActivity extends Activity {
    private boolean done;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent i = getIntent();
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null) text = "";
            String url = firstUrl(text);
            if (url != null) Sync.sendOpen(this, url);
            else Sync.sendClip(this, text);
            done = true;
            finish();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (!focus || done) return;
        done = true;
        String text = "";
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData cd = cm != null ? cm.getPrimaryClip() : null;
            if (cd != null && cd.getItemCount() > 0) {
                CharSequence t = cd.getItemAt(0).coerceToText(this);
                if (t != null) text = t.toString();
            }
        } catch (Throwable ignored) { }
        Sync.sendClip(this, text);
        finish();
    }

    static String firstUrl(String s) {
        for (String part : s.split("\\s+")) {
            if (part.startsWith("http://") || part.startsWith("https://")) return part;
        }
        return null;
    }
}
