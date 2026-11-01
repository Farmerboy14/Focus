package com.caleb.focus;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** The encrypted link to Focus on the PC. See PROTOCOL.md. */
public final class Sync {
    private Sync() { }

    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final String RELAY = "https://ntfy.sh/";
    private static final SecureRandom rnd = new SecureRandom();
    private static volatile Thread listener;
    private static volatile boolean stop;
    private static volatile long lastHeard;
    private static final Handler main = new Handler(Looper.getMainLooper());

    // ---------- pairing ----------

    public static String normalize(String code) {
        if (code == null) return "";
        StringBuilder b = new StringBuilder();
        for (char ch : code.toUpperCase(Locale.US).toCharArray()) if (ALPHABET.indexOf(ch) >= 0) b.append(ch);
        return b.toString();
    }

    public static String code(Context c) { return Store.get(c).prefs().getString("pairCode", ""); }

    public static boolean paired(Context c) { return code(c).length() == 16; }

    public static long lastHeard() { return lastHeard; }

    public static void pair(Context c, String code) {
        Store.get(c).prefs().edit().putString("pairCode", normalize(code)).remove("ntfyLast").apply();
        restart(c);
    }

    public static void unpair(Context c) {
        Store.get(c).prefs().edit().remove("pairCode").remove("ntfyLast").apply();
        stop = true;
        Thread t = listener;
        if (t != null) t.interrupt();
        listener = null;
    }

    private static byte[] sha(String s) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
    }

    static String topic(String code) throws Exception {
        byte[] h = sha("focus-topic:" + code);
        StringBuilder b = new StringBuilder("focus-");
        for (int i = 0; i < 20; i++) b.append(String.format(Locale.US, "%02x", h[i] & 0xff));
        return b.toString();
    }

    static String encrypt(String code, String plain) throws Exception {
        byte[] iv = new byte[12];
        rnd.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(sha("focus-key:" + code), "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(ct, 0, out, iv.length, ct.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }

    static String decrypt(String code, String wire) throws Exception {
        byte[] all = Base64.decode(wire.trim(), Base64.DEFAULT);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(sha("focus-key:" + code), "AES"), new GCMParameterSpec(128, all, 0, 12));
        return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }

    // ---------- sending ----------

    private static JSONObject envelope(String type) throws Exception {
        JSONObject o = new JSONObject();
        o.put("v", 1);
        o.put("from", "phone");
        byte[] id = new byte[6];
        rnd.nextBytes(id);
        StringBuilder b = new StringBuilder();
        for (byte x : id) b.append(String.format(Locale.US, "%02x", x & 0xff));
        o.put("id", b.toString());
        o.put("at", System.currentTimeMillis());
        o.put("t", type);
        return o;
    }

    private static void send(final Context ctx, final JSONObject env, final boolean tellUser) {
        final Context c = ctx.getApplicationContext();
        final String code = code(c);
        if (code.length() != 16) {
            if (tellUser) toast(c, "Connect your PC first: Setup → Connect to your PC.");
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                boolean ok = false;
                try {
                    String wire = encrypt(code, env.toString());
                    HttpURLConnection con = (HttpURLConnection) new URL(RELAY + topic(code)).openConnection();
                    con.setRequestMethod("POST");
                    con.setDoOutput(true);
                    con.setConnectTimeout(15000);
                    con.setReadTimeout(20000);
                    con.setRequestProperty("Content-Type", "text/plain");
                    OutputStream os = con.getOutputStream();
                    os.write(wire.getBytes(StandardCharsets.UTF_8));
                    os.close();
                    ok = con.getResponseCode() / 100 == 2;
                    con.disconnect();
                } catch (Throwable ignored) { }
                if (tellUser) toast(c, ok ? "Sent to your PC" : "Couldn't reach your PC. Check your connection.");
            }
        }).start();
    }

    public static void sendClip(Context c, String text) {
        try {
            if (text == null || text.isEmpty()) { toast(c, "Your clipboard is empty."); return; }
            JSONObject e = envelope("clip");
            e.put("text", text.length() > 2000 ? text.substring(0, 2000) : text);
            send(c, e, true);
        } catch (Throwable ignored) { }
    }

    public static void sendOpen(Context c, String url) {
        try {
            JSONObject e = envelope("open");
            e.put("url", url);
            send(c, e, true);
        } catch (Throwable ignored) { }
    }

    public static void sendBible(Context c, int book, int chapter) {
        try {
            JSONObject e = envelope("bible");
            e.put("book", book);
            e.put("chapter", chapter);
            send(c, e, true);
        } catch (Throwable ignored) { }
    }

    public static JSONObject sched(Context c) throws Exception {
        Store s = Store.get(c);
        JSONObject sc = new JSONObject();
        JSONArray bl = new JSONArray();
        for (Store.Block b : s.blocks) {
            JSONObject j = new JSONObject();
            j.put("title", b.title); j.put("preset", b.preset); j.put("len", b.len);
            bl.put(j);
        }
        sc.put("blocks", bl);
        sc.put("defaultWake", s.defaultWake);
        sc.put("wakeAt", s.wakeAt);
        sc.put("prevWakeAt", s.prevWakeAt);
        JSONObject names = new JSONObject();
        for (String id : Store.PRESET_IDS) names.put(id, s.presetName(id));
        sc.put("names", names);
        sc.put("editedAt", s.editedAt);
        return sc;
    }

    public static void pushState(Context c) {
        try {
            if (!paired(c)) return;
            JSONObject e = envelope("state");
            e.put("sched", sched(c));
            send(c, e, false);
        } catch (Throwable ignored) { }
    }

    // ---------- listening ----------

    /** Keeps one listener running while paired. Safe to call often. */
    public static synchronized void ensure(Context ctx) {
        final Context c = ctx.getApplicationContext();
        if (!paired(c)) return;
        Thread t = listener;
        if (t != null && t.isAlive()) return;
        stop = false;
        t = new Thread(new Runnable() { @Override public void run() { loop(c); } }, "focus-sync");
        t.setDaemon(true);
        listener = t;
        t.start();
    }

    public static synchronized void restart(Context c) {
        stop = true;
        Thread t = listener;
        if (t != null) t.interrupt();
        listener = null;
        ensure(c);
    }

    private static void loop(Context c) {
        long backoff = 2000;
        while (!stop) {
            String code = code(c);
            if (code.length() != 16) return;
            HttpURLConnection con = null;
            try {
                SharedPreferences sp = Store.get(c).prefs();
                String since = sp.getString("ntfyLast", "10m");
                con = (HttpURLConnection) new URL(RELAY + topic(code) + "/json?since=" + since).openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(90000);
                BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8));
                // Say hello so the PC sends its day, then send ours.
                JSONObject hello = envelope("hello");
                send(c, hello, false);
                pushState(c);
                backoff = 2000;
                String line;
                while (!stop && (line = r.readLine()) != null) {
                    lastHeard = System.currentTimeMillis();
                    if (line.isEmpty()) continue;
                    JSONObject ev = new JSONObject(line);
                    if (!"message".equals(ev.optString("event"))) continue;
                    sp.edit().putString("ntfyLast", ev.optString("id", "10m")).apply();
                    try {
                        JSONObject env = new JSONObject(decrypt(code, ev.optString("message")));
                        if ("phone".equals(env.optString("from"))) continue;
                        handle(c, env);
                    } catch (Throwable ignored) { /* not ours or not readable */ }
                }
            } catch (Throwable t) {
                if (stop) return;
            } finally {
                if (con != null) try { con.disconnect(); } catch (Throwable ignored) { }
            }
            try { Thread.sleep(backoff); } catch (InterruptedException e) { if (stop) return; }
            backoff = Math.min(60000, backoff * 2);
        }
    }

    private static void handle(final Context c, final JSONObject env) {
        final String t = env.optString("t");
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    if ("hello".equals(t)) {
                        pushState(c);
                    } else if ("state".equals(t)) {
                        JSONObject sc = env.optJSONObject("sched");
                        if (sc != null && Store.get(c).applyRemote(sc)) toast(c, "Your day was updated from your PC.");
                    } else if ("clip".equals(t)) {
                        ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("From your PC", env.optString("text")));
                        toast(c, "Copied from your PC");
                    } else if ("open".equals(t)) {
                        String url = env.optString("url");
                        if (url.startsWith("http://") || url.startsWith("https://")) {
                            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            c.startActivity(i);
                        }
                    } else if ("bible".equals(t)) {
                        Intent i = new Intent(c, BibleActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        i.putExtra("book", env.optInt("book", 40));
                        i.putExtra("chapter", env.optInt("chapter", 1));
                        c.startActivity(i);
                    } else if ("note".equals(t)) {
                        toast(c, env.optString("text"));
                    }
                } catch (Throwable ignored) { }
            }
        });
    }

    private static void toast(final Context c, final String msg) {
        main.post(new Runnable() { @Override public void run() { Toast.makeText(c, msg, Toast.LENGTH_SHORT).show(); } });
    }
}
