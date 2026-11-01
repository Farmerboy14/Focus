package com.caleb.focus;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Checks the Focus GitHub repo for a newer version and installs it in place. */
public final class Updater {
    private Updater() { }

    static final String BASE = "https://raw.githubusercontent.com/Farmerboy14/focus/main/release/";
    static final String ACTION = "com.caleb.focus.INSTALL_STATUS";

    public static class Info {
        public int code;
        public String name, notes, apk;
    }

    public interface Callback { void done(Info newer, String error); }

    private static Info available;
    private static boolean busy;

    public static Info available() { return available; }

    public static int installedCode(Context c) {
        try {
            return (int) c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
        } catch (Throwable t) { return 0; }
    }

    public static String installedName(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Throwable t) { return "?"; }
    }

    /** Looks for a newer version. Without force, checks at most every 20 minutes. */
    public static void check(final Context ctx, boolean force, final Callback cb) {
        final Context c = ctx.getApplicationContext();
        final android.content.SharedPreferences sp = Store.get(c).prefs();
        long now = System.currentTimeMillis();
        if (!force && now - sp.getLong("updCheckedAt", 0) < 20 * 60_000L) {
            if (cb != null) cb.done(available, null);
            return;
        }
        sp.edit().putLong("updCheckedAt", now).apply();
        new Thread(new Runnable() {
            @Override
            public void run() {
                Info found = null;
                String err = null;
                try {
                    byte[] b = get(BASE + "version.json?t=" + System.currentTimeMillis());
                    JSONObject o = new JSONObject(new String(b, "UTF-8"));
                    Info i = new Info();
                    i.code = o.getInt("code");
                    i.name = o.optString("name", String.valueOf(i.code));
                    i.notes = o.optString("notes", "");
                    i.apk = o.optString("apk", BASE + "Focus.apk");
                    if (i.code > installedCode(c)) found = i;
                } catch (Throwable t) {
                    err = "Couldn't reach GitHub. Check your connection.";
                }
                available = found;
                final Info f = found;
                final String e = err;
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override public void run() { if (cb != null) cb.done(f, e); }
                });
            }
        }).start();
    }

    private static byte[] get(String url) throws Exception {
        HttpURLConnection con = null;
        for (int hop = 0; hop < 5; hop++) {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            con.setInstanceFollowRedirects(true);
            con.setRequestProperty("Cache-Control", "no-cache");
            int code = con.getResponseCode();
            if (code >= 300 && code < 400 && con.getHeaderField("Location") != null) {
                url = con.getHeaderField("Location");
                con.disconnect();
                continue;
            }
            if (code != 200) throw new Exception("HTTP " + code);
            break;
        }
        InputStream in = con.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        con.disconnect();
        return out.toByteArray();
    }

    /** Downloads and installs the update. Android shows its own Install confirmation. */
    public static void install(final Activity a, final Info info) {
        if (info == null || busy) return;
        PackageManager pm = a.getPackageManager();
        if (!pm.canRequestPackageInstalls()) {
            Toast.makeText(a, "Turn on “Allow from this source” for Focus, then come back and tap Update again.", Toast.LENGTH_LONG).show();
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            return;
        }
        busy = true;
        Toast.makeText(a, "Downloading Focus " + info.name + "…", Toast.LENGTH_SHORT).show();
        final Context c = a.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                String err = null;
                try {
                    byte[] apk = get(info.apk + (info.apk.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis());
                    PackageInstaller pi = c.getPackageManager().getPackageInstaller();
                    PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                    p.setAppPackageName(c.getPackageName());
                    if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
                    int id = pi.createSession(p);
                    PackageInstaller.Session s = pi.openSession(id);
                    OutputStream os = s.openWrite("focus.apk", 0, apk.length);
                    os.write(apk);
                    s.fsync(os);
                    os.close();
                    Intent i = new Intent(ACTION).setPackage(c.getPackageName());
                    PendingIntent pend = PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    s.commit(pend.getIntentSender());
                    s.close();
                } catch (Throwable t) {
                    err = "Update failed: " + t.getMessage();
                }
                busy = false;
                final String e = err;
                if (e != null) {
                    new Handler(Looper.getMainLooper()).post(new Runnable() {
                        @Override public void run() { Toast.makeText(c, e, Toast.LENGTH_LONG).show(); }
                    });
                }
            }
        }).start();
    }

    /** Hears back from Android's installer. */
    public static class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { c.startActivity(confirm); } catch (Throwable ignored) { }
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Toast.makeText(c, "Update didn't install" + (msg != null ? ": " + msg : "."), Toast.LENGTH_LONG).show();
            }
        }
    }
}
