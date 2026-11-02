package com.caleb.focus;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.drawable.Drawable;
import android.provider.MediaStore;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** The apps on the phone, and which ones always stay open (calls, texts, camera, calculator, clock). */
public final class Apps {
    private Apps() { }

    public static class AppInfo {
        public String pkg, label;
        public Drawable icon;
    }

    private static List<AppInfo> cache;
    private static long cacheAt;
    private static Set<String> essentials, systemSafe;
    private static long essAt;
    private static Map<String, Boolean> games = new HashMap<>();
    private static String rejoice;
    private static boolean rejoiceChecked;

    public static synchronized List<AppInfo> launchable(Context c, boolean fresh) {
        if (!fresh && cache != null && System.currentTimeMillis() - cacheAt < 5 * 60_000) return cache;
        PackageManager pm = c.getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> res = pm.queryIntentActivities(i, 0);
        Map<String, AppInfo> byPkg = new HashMap<>();
        for (ResolveInfo r : res) {
            String p = r.activityInfo.packageName;
            if (p.equals(c.getPackageName()) || byPkg.containsKey(p)) continue;
            AppInfo a = new AppInfo();
            a.pkg = p;
            CharSequence l = r.loadLabel(pm);
            a.label = l != null ? l.toString() : p;
            byPkg.put(p, a);
        }
        List<AppInfo> out = new ArrayList<>(byPkg.values());
        Collections.sort(out, new Comparator<AppInfo>() {
            @Override public int compare(AppInfo a, AppInfo b) { return a.label.compareToIgnoreCase(b.label); }
        });
        cache = out;
        cacheAt = System.currentTimeMillis();
        rejoiceChecked = false;
        return out;
    }

    private static final Map<String, Drawable> icons = new HashMap<>();

    public static synchronized Drawable icon(Context c, String pkg) {
        Drawable d = icons.get(pkg);
        if (d == null) {
            try { d = c.getPackageManager().getApplicationIcon(pkg); } catch (Throwable ignored) { }
            if (d != null) icons.put(pkg, d);
        }
        return d;
    }

    public static String label(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Throwable t) {
            return pkg;
        }
    }

    private static String resolvePkg(Context c, Intent i) {
        try {
            ResolveInfo r = c.getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
            if (r != null && r.activityInfo != null && !"android".equals(r.activityInfo.packageName)) return r.activityInfo.packageName;
        } catch (Throwable ignored) { }
        return null;
    }

    private static synchronized void build(Context c) {
        if (essentials != null && System.currentTimeMillis() - essAt < 10 * 60_000) return;
        Set<String> e = new HashSet<>();
        Set<String> s = new HashSet<>();
        try {
            TelecomManager tm = (TelecomManager) c.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && tm.getDefaultDialerPackage() != null) e.add(tm.getDefaultDialerPackage());
        } catch (Throwable ignored) { }
        try {
            String sms = Telephony.Sms.getDefaultSmsPackage(c);
            if (sms != null) e.add(sms);
        } catch (Throwable ignored) { }
        String cam = resolvePkg(c, new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA));
        if (cam != null) e.add(cam);
        cam = resolvePkg(c, new Intent(MediaStore.ACTION_IMAGE_CAPTURE));
        if (cam != null) e.add(cam);
        String[][] cats = {{Intent.CATEGORY_APP_CALCULATOR}, {Intent.CATEGORY_APP_CONTACTS}, {Intent.CATEGORY_APP_MESSAGING}};
        for (String[] cat : cats) {
            String p = resolvePkg(c, Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, cat[0]));
            if (p != null) e.add(p);
        }
        String[] known = {
                "com.google.android.dialer", "com.google.android.apps.messaging", "com.google.android.GoogleCamera",
                "com.google.android.calculator", "com.google.android.deskclock", "com.google.android.apps.photos", "com.google.android.contacts",
                "com.android.phone", "com.android.server.telecom", "com.android.camera2", "com.android.calculator2",
                "com.android.deskclock", "com.android.contacts", "com.android.mms", "com.android.dialer"
        };
        for (String k : known) e.add(k);
        // Pieces of the system that must never be blocked.
        String[] sys = {
                c.getPackageName(), "android", "com.android.systemui", "com.android.settings", "com.google.android.permissioncontroller",
                "com.android.permissioncontroller", "com.google.android.packageinstaller", "com.android.packageinstaller",
                "com.android.vending", "com.google.android.gms", "com.google.android.apps.wellbeing", "com.android.emergency",
                "com.google.android.apps.safetyhub", "com.android.intentresolver", "com.google.android.documentsui",
                "com.android.documentsui", "com.google.android.apps.nexuslauncher", "com.android.launcher3",
                "com.google.android.setupwizard", "com.android.providers.media", "com.google.android.apps.restore",
                "com.google.android.inputmethod.latin", "com.android.bluetooth", "com.google.android.networkstack",
                "com.google.android.cellbroadcastreceiver", "com.android.cellbroadcastreceiver", "com.google.android.providers.media.module",
                "com.google.android.settings.intelligence", "com.android.credentialmanager", "com.android.stk",
                "com.google.android.apps.walletnfcrel", "com.google.android.apps.carrier.carrierwifi"
        };
        for (String k : sys) s.add(k);
        try {
            InputMethodManager imm = (InputMethodManager) c.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) for (InputMethodInfo im : imm.getEnabledInputMethodList()) s.add(im.getPackageName());
        } catch (Throwable ignored) { }
        try {
            Intent home = new Intent(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            for (ResolveInfo r : c.getPackageManager().queryIntentActivities(home, 0)) s.add(r.activityInfo.packageName);
        } catch (Throwable ignored) { }
        essentials = e;
        systemSafe = s;
        essAt = System.currentTimeMillis();
    }

    public static boolean isEssential(Context c, String pkg) {
        build(c);
        return essentials.contains(pkg);
    }

    public static boolean isSystemSafe(Context c, String pkg) {
        build(c);
        return systemSafe.contains(pkg);
    }

    public static synchronized boolean isGame(Context c, String pkg) {
        Boolean g = games.get(pkg);
        if (g != null) return g;
        boolean r = false;
        try {
            ApplicationInfo ai = c.getPackageManager().getApplicationInfo(pkg, 0);
            r = ai.category == ApplicationInfo.CATEGORY_GAME || (ai.flags & ApplicationInfo.FLAG_IS_GAME) != 0;
        } catch (Throwable ignored) { }
        games.put(pkg, r);
        return r;
    }

    public static synchronized String rejoiceify(Context c) {
        if (rejoiceChecked) return rejoice;
        rejoice = null;
        for (AppInfo a : launchable(c, false)) {
            if (a.label.toLowerCase(Locale.US).contains("rejoice")) { rejoice = a.pkg; break; }
        }
        rejoiceChecked = true;
        return rejoice;
    }

    private static java.util.Set<String> guitar;

    /** Caleb's guitar app (any app with "guitar" in its name) is allowed in Strict for practice. */
    public static synchronized boolean isGuitar(Context c, String pkg) {
        if (guitar == null || !rejoiceChecked) {
            guitar = new HashSet<>();
            for (AppInfo a : launchable(c, false)) if (a.label.toLowerCase(Locale.US).contains("guitar")) guitar.add(a.pkg);
        }
        return guitar.contains(pkg);
    }

    public static boolean isRejoiceify(Context c, String pkg) {
        String r = rejoiceify(c);
        return r != null && r.equals(pkg);
    }

    public static boolean launch(Context c, String pkg) {
        try {
            Intent i = c.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
