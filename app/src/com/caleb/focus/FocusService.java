package com.caleb.focus;

import android.accessibilityservice.AccessibilityService;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;
import java.util.Locale;

/**
 * Watches which app comes to the front. If the current block doesn't allow it,
 * goes home and shows "Not now". Also counts YouTube time inside Chrome and
 * turns Do Not Disturb on and off with the blocks.
 */
public class FocusService extends AccessibilityService {
    private static final long TICK = 15_000;
    private final Handler h = new Handler(Looper.getMainLooper());
    private String fg;
    private String lastBlockedPkg;
    private long lastBlockedAt;
    private String lastPresetId;
    private long ytSince;        // when YouTube in Chrome was last seen open
    private long lastUrlCheck;
    private boolean onYouTube;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            try { onTick(); } catch (Throwable ignored) { }
            h.postDelayed(this, TICK);
        }
    };

    public static boolean isOn(Context c) {
        String s = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (s == null) return false;
        String me = new ComponentName(c, FocusService.class).flattenToString();
        String meShort = new ComponentName(c, FocusService.class).flattenToShortString();
        TextUtils.SimpleStringSplitter sp = new TextUtils.SimpleStringSplitter(':');
        sp.setString(s);
        while (sp.hasNext()) {
            String x = sp.next();
            if (x.equalsIgnoreCase(me) || x.equalsIgnoreCase(meShort)) return true;
        }
        return false;
    }

    // Put the Focus lock screen in place as the screen goes off, so it's there the moment it wakes.
    private final android.content.BroadcastReceiver screen = new android.content.BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (!Intent.ACTION_SCREEN_OFF.equals(i.getAction())) return;
            leaveYouTube();
            if (!LockActivity.enabled(c)) return;
            try {
                android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
                int mode = am != null ? am.getMode() : android.media.AudioManager.MODE_NORMAL;
                if (mode != android.media.AudioManager.MODE_NORMAL) return; // on a call or ringing
                Intent l = new Intent(c, LockActivity.class);
                l.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                startActivity(l);
            } catch (Throwable ignored) { }
        }
    };
    private boolean screenRegistered;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        try {
            if (!screenRegistered) {
                registerReceiver(screen, new android.content.IntentFilter(Intent.ACTION_SCREEN_OFF));
                screenRegistered = true;
            }
        } catch (Throwable ignored) { }
        h.removeCallbacks(tick);
        h.post(tick);
        Sync.ensure(this);
    }

    @Override
    public void onDestroy() {
        h.removeCallbacks(tick);
        if (screenRegistered) { try { unregisterReceiver(screen); } catch (Throwable ignored) { } screenRegistered = false; }
        try {
            if (Store.get(this).prefs().getBoolean("dndByUs", false)) {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null && nm.isNotificationPolicyAccessGranted()) nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
                Store.get(this).prefs().edit().putBoolean("dndByUs", false).apply();
            }
        } catch (Throwable ignored) { }
        super.onDestroy();
    }

    @Override
    public void onInterrupt() { }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        try {
            if (e == null || e.getPackageName() == null) return;
            String pkg = e.getPackageName().toString();
            int type = e.getEventType();
            if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                if ("com.android.systemui".equals(pkg)) return;
                // Only real screens count: popups, autofill and overlays are not the app in front.
                if (!isActivity(pkg, e.getClassName())) return;
                if (Apps.isSystemSafe(this, pkg) && !pkg.equals(getPackageName())
                        && !"com.android.settings".equals(pkg)) {
                    // Play Store, Files, share sheet and the like: never blocked, but they are in front now.
                    if (!isHomePkg(pkg)) {
                        if (!pkg.equals(fg)) { leaveYouTube(); fg = pkg; }
                        return;
                    }
                }
                if (!pkg.equals(fg)) {
                    leaveYouTube();
                    fg = pkg;
                }
                if (locked()) return; // alarms and incoming calls show over the lock screen
                check(pkg);
                if ("com.android.chrome".equals(pkg)) checkChromeUrl(true);
            } else if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                if ("com.android.chrome".equals(pkg) && "com.android.chrome".equals(fg)) checkChromeUrl(false);
            }
        } catch (Throwable ignored) { }
    }

    private final java.util.Map<String, Boolean> activities = new java.util.HashMap<>();

    private boolean isActivity(String pkg, CharSequence cls) {
        if (cls == null) return false;
        String key = pkg + "/" + cls;
        Boolean b = activities.get(key);
        if (b != null) return b;
        boolean r = false;
        try {
            getPackageManager().getActivityInfo(new ComponentName(pkg, cls.toString()), 0);
            r = true;
        } catch (Exception ignored) { }
        if (activities.size() > 500) activities.clear();
        activities.put(key, r);
        return r;
    }

    private boolean isHomePkg(String pkg) {
        return pkg.equals(getPackageName()) || pkg.contains("launcher");
    }

    private void check(String pkg) {
        if (pkg.equals(getPackageName())) return;
        long now = System.currentTimeMillis();
        Store s = Store.get(this);
        Store.Decision d = s.decide(this, pkg, now);
        if (d.mode == Store.ALLOW) return;
        block(pkg, d.mode == Store.REASON ? "reason" : (d.entertainment ? "entertainment" : "block"));
    }

    private boolean locked() {
        try {
            android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null && km.isKeyguardLocked()) return true;
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            return pm != null && !pm.isInteractive();
        } catch (Throwable t) { return false; }
    }

    private void block(final String pkg, final String kind) {
        long now = System.currentTimeMillis();
        if ("youtube".equals(kind)) {
            // Move Chrome off the YouTube tab instead of locking Chrome for the rest of the day.
            try {
                Intent g = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.google.com"));
                g.setPackage("com.android.chrome");
                g.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(g);
            } catch (Throwable t) {
                performGlobalAction(GLOBAL_ACTION_HOME);
            }
        } else {
            performGlobalAction(GLOBAL_ACTION_HOME);
        }
        if (pkg.equals(lastBlockedPkg) && now - lastBlockedAt < 1500) return;
        lastBlockedPkg = pkg;
        lastBlockedAt = now;
        h.postDelayed(new Runnable() {
            @Override
            public void run() {
                Intent i = new Intent(FocusService.this, BlockedActivity.class);
                i.putExtra("pkg", pkg);
                i.putExtra("kind", kind);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                try { startActivity(i); } catch (Throwable ignored) { }
            }
        }, 320);
    }

    // ---------- YouTube in Chrome ----------

    private void checkChromeUrl(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastUrlCheck < 1500) return;
        lastUrlCheck = now;
        boolean yt = false;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null) {
            try {
                List<AccessibilityNodeInfo> bars = root.findAccessibilityNodeInfosByViewId("com.android.chrome:id/url_bar");
                if (bars != null) {
                    for (AccessibilityNodeInfo n : bars) {
                        CharSequence t = n.getText();
                        if (t != null) {
                            String u = t.toString().toLowerCase(Locale.US);
                            if (u.contains("youtube.com") || u.contains("youtu.be")) yt = true;
                        }
                    }
                }
            } catch (Throwable ignored) { }
        }
        if (yt && !onYouTube) { onYouTube = true; ytSince = now; }
        else if (!yt && onYouTube) leaveYouTube();
        if (onYouTube) enforceYouTube(now);
    }

    private void leaveYouTube() {
        if (!onYouTube) return;
        long now = System.currentTimeMillis();
        Store s = Store.get(this);
        s.addYouTube(Math.min(now - ytSince, TICK * 2), now);
        s.save();
        onYouTube = false;
    }

    private void enforceYouTube(long now) {
        Store s = Store.get(this);
        if ("free".equals(s.currentPreset(now).id)) return;
        long used = s.ytUsed(now) + (now - ytSince);
        if (used >= s.ytLimitMin * Store.MIN) {
            leaveYouTube();
            lastBlockedPkg = null;
            block("com.android.chrome", "youtube");
        }
    }

    // ---------- every few seconds ----------

    private void onTick() {
        long now = System.currentTimeMillis();
        Store s = Store.get(this);
        if (locked()) { leaveYouTube(); return; }
        if (onYouTube) {
            s.addYouTube(now - ytSince, now);
            ytSince = now;
            s.save();
            enforceYouTube(now);
        }
        Sync.ensure(this);
        Store.Preset p = s.currentPreset(now);
        if (!p.id.equals(lastPresetId)) {
            lastPresetId = p.id;
            applyDnd(p);
        }
        // Re-check what's in front: catches block changes and reason passes that ran out.
        if (fg != null && !fg.equals(getPackageName())) check(fg);
    }

    private void applyDnd(Store.Preset p) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null || !nm.isNotificationPolicyAccessGranted()) return;
            boolean weSet = Store.get(this).prefs().getBoolean("dndByUs", false);
            if (p.dnd) {
                if (nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_ALL) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
                    Store.get(this).prefs().edit().putBoolean("dndByUs", true).apply();
                }
            } else if (weSet) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
                Store.get(this).prefs().edit().putBoolean("dndByUs", false).apply();
            }
        } catch (Throwable ignored) { }
    }
}
