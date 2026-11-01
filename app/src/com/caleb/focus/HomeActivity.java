package com.caleb.focus;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** The home screen: the focus ring, what's next, and only the apps this block allows. */
public class HomeActivity extends Activity {
    private final Handler h = new Handler(Looper.getMainLooper());
    private SkyView sky;
    private DialView dial;
    private TextView clock, pill, big, sub, title, appsLabel;
    private LinearLayout upcomingRow, banner, updBanner;
    private TextView updText;
    private FlowLayout apps;
    private TextView action;
    private String shownKey = "";

    private final Runnable refresh = new Runnable() {
        @Override public void run() { render(false); h.postDelayed(this, 30_000); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        sky = new SkyView(this, false);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 10), 0);

        LinearLayout head = Ui.row(this);
        clock = Ui.mono(this, "", 12, 0xFFB4B7BE);
        head.addView(clock);
        head.addView(Ui.space(this));
        pill = Ui.stone(this, "", Ui.ICE_SOFT, 0x29AACFF6, 999, 12);
        pill.setTypeface(Ui.SORA_SEMI);
        pill.setPadding(Ui.dp(this, 12), Ui.dp(this, 6), Ui.dp(this, 12), Ui.dp(this, 6));
        pill.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Ui.open(HomeActivity.this, ScheduleActivity.class); }
        });
        head.addView(pill);
        col.addView(head, Ui.lp(Ui.MATCH, Ui.dp(this, 32)));

        banner = Ui.row(this);
        banner.setBackground(new Ui.StoneDrawable(this, Ui.STONE, Ui.BORDER_GOLD_STRONG, 16));
        banner.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
        TextView bt = Ui.text(this, "App blocking is off. Tap to finish setup.", 13, Ui.GOLD, Ui.SORA);
        banner.addView(bt, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        banner.addView(Ui.text(this, "→", 16, Ui.GOLD, Ui.SORA));
        banner.setClickable(true);
        Ui.press(banner);
        banner.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Ui.open(HomeActivity.this, SetupActivity.class); }
        });
        col.addView(banner, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));

        updBanner = Ui.row(this);
        updBanner.setBackground(new Ui.StoneDrawable(this, Ui.STONE, Ui.BORDER_GOLD_STRONG, 16));
        updBanner.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
        updText = Ui.text(this, "", 13, Ui.GOLD, Ui.SORA);
        updBanner.addView(updText, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        updBanner.addView(Ui.text(this, "Update", 13, Ui.GOLD, Ui.SORA_SEMI));
        updBanner.setClickable(true);
        Ui.press(updBanner);
        updBanner.setVisibility(View.GONE);
        updBanner.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Updater.install(HomeActivity.this, Updater.available()); }
        });
        col.addView(updBanner, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));

        int sw = getResources().getDisplayMetrics().widthPixels;
        int dialSize = Math.min(sw - Ui.dp(this, 40), Ui.dp(this, 330));
        FrameLayout dialFrame = new FrameLayout(this);
        dial = new DialView(this, false);
        dialFrame.addView(dial, new FrameLayout.LayoutParams(dialSize, dialSize));
        LinearLayout center = Ui.column(this);
        center.setGravity(Gravity.CENTER);
        big = Ui.text(this, "", 66, Ui.INK, Ui.SORA_LIGHT);
        big.setLetterSpacing(-0.03f);
        big.setFontFeatureSettings("tnum");
        big.setGravity(Gravity.CENTER);
        big.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        sub = Ui.label(this, "");
        title = Ui.text(this, "", 15, Ui.INK, Ui.SORA_MED);
        title.setGravity(Gravity.CENTER);
        title.setPadding(Ui.dp(this, 70), 0, Ui.dp(this, 70), 0);
        center.addView(big, Ui.lp(Ui.MATCH, Ui.WRAP));
        sub.setGravity(Gravity.CENTER);
        center.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        center.addView(title, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        dialFrame.addView(center, new FrameLayout.LayoutParams(dialSize, dialSize));
        dialFrame.setClickable(true);
        dialFrame.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Store.Slot s = Store.get(HomeActivity.this).current(System.currentTimeMillis());
                Ui.open(HomeActivity.this, "god".equals(s.preset) ? GodActivity.class : ScheduleActivity.class);
            }
        });
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(dialSize, dialSize);
        dlp.gravity = Gravity.CENTER_HORIZONTAL;
        dlp.topMargin = Ui.dp(this, 6);
        col.addView(dialFrame, dlp);

        upcomingRow = Ui.row(this);
        col.addView(upcomingRow, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));

        appsLabel = Ui.label(this, "");
        col.addView(appsLabel, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 18)));
        apps = new FlowLayout(this, Ui.dp(this, 8));
        col.addView(apps, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        col.addView(Ui.space(this));

        action = Ui.goldButton(this, "");
        col.addView(action, Ui.lp(Ui.MATCH, Ui.WRAP));

        LinearLayout nav = Ui.row(this);
        nav.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 4));
        nav.addView(navItem("Today", ScheduleActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("All apps", AppsActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("Presets", PresetsActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("Setup", SetupActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        View line = new View(this);
        line.setBackgroundColor(0x24A0BEF0);
        col.addView(line, Ui.lp(Ui.MATCH, Math.max(1, Ui.dp(this, 1)), Ui.dp(this, 12)));
        col.addView(nav, Ui.lp(Ui.MATCH, Ui.WRAP));

        setContentView(root);
        matchWallpaper(this, false);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    new OnBackInvokedCallback() { @Override public void onBackInvoked() { } });
        }
    }

    /**
     * Android's app-switching animation shows the phone's wallpaper around the edges.
     * Setting the home and lock screen wallpaper to the same night sky makes those edges match Focus.
     */
    public static void matchWallpaper(final android.content.Context ctx, boolean force) {
        final android.content.Context c = ctx.getApplicationContext();
        final android.content.SharedPreferences sp = Store.get(c).prefs();
        if (!force && sp.getBoolean("wallMatched2", false)) return;
        sp.edit().putBoolean("wallMatched2", true).apply();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    android.graphics.Bitmap b = android.graphics.BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_night);
                    android.app.WallpaperManager.getInstance(c).setBitmap(b, null, true,
                            android.app.WallpaperManager.FLAG_SYSTEM | android.app.WallpaperManager.FLAG_LOCK);
                } catch (Throwable ignored) { }
            }
        }).start();
    }

    private void showUpdate(Updater.Info newer) {
        if (newer == null) { updBanner.setVisibility(View.GONE); return; }
        updText.setText("Focus " + newer.name + " is ready." + (newer.notes.isEmpty() ? "" : " " + newer.notes));
        if (updBanner.getVisibility() != View.VISIBLE) {
            updBanner.setVisibility(View.VISIBLE);
            Ui.stagger(updBanner);
        }
    }

    private TextView navItem(String label, final Class<?> cls) {
        TextView t = Ui.text(this, label, 14, Ui.INK, Ui.SORA_MED);
        t.setGravity(Gravity.CENTER);
        t.setClickable(true);
        t.setFocusable(true);
        t.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Ui.open(HomeActivity.this, cls); }
        });
        return t;
    }

    @Override
    public void onBackPressed() { /* this is home: nowhere to go back to */ }

    @Override
    protected void onResume() {
        super.onResume();
        render(true);
        Updater.check(this, false, new Updater.Callback() {
            @Override public void done(Updater.Info newer, String error) { showUpdate(newer); }
        });
        h.removeCallbacks(refresh);
        h.postDelayed(refresh, 30_000);
    }

    @Override
    protected void onPause() {
        h.removeCallbacks(refresh);
        super.onPause();
    }

    private void render(boolean entering) {
        try { doRender(entering); } catch (Throwable t) { /* never let the home screen crash */ }
    }

    private void doRender(boolean entering) {
        final Store s = Store.get(this);
        long now = System.currentTimeMillis();
        final Store.Slot cur = s.current(now);
        Store.Preset p = s.presets.get(cur.preset);
        if (p == null) p = s.presets.get("normal");
        boolean god = "god".equals(cur.preset);

        clock.setText(new SimpleDateFormat("h:mm a · EEE", Locale.US).format(new Date(now)).toUpperCase(Locale.US));
        pill.setText(cur.title);
        pill.setTextColor(god ? Ui.GOLD : Ui.ICE_SOFT);
        pill.setBackground(new Ui.StoneDrawable(this, Ui.STONE, god ? Ui.BORDER_GOLD : 0x29AACFF6, 999));
        banner.setVisibility(FocusService.isOn(this) ? View.GONE : View.VISIBLE);
        sky.setDawn(god);
        dial.setGold(god);
        dial.setGlint(god);

        long left = cur.minutesLeft(now);
        long len = cur.lengthMin();
        big.setText(Ui.hm(left));
        sub.setText(("of " + Ui.hm(len) + " left").toUpperCase(Locale.US));
        title.setText(cur.index < 0 ? "Open time · until " + Ui.clock(cur.end) : cur.title);

        List<Store.Slot> slots = s.slots(now);
        float[] hours = new float[slots.size()];
        for (int i = 0; i < slots.size(); i++) hours[i] = hourOf(slots.get(i).start);
        dial.setStars(hours, hourOf(now));
        String key = cur.title + cur.start;
        boolean animate = entering || !key.equals(shownKey);
        dial.setRemaining(left / (float) len, animate);
        shownKey = key;

        // next up
        upcomingRow.removeAllViews();
        List<Store.Slot> next = s.upcoming(now, 3);
        for (int i = 0; i < next.size(); i++) {
            Store.Slot n = next.get(i);
            LinearLayout card = Ui.column(this);
            card.setBackground(new Ui.StoneDrawable(this, Ui.STONE, 0x1AAACFF6, 16));
            card.setPadding(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12), Ui.dp(this, 10));
            card.addView(Ui.text(this, Ui.clockShort(n.start), 11, Ui.MUTED, Ui.MONO));
            TextView tt = Ui.text(this, n.title, 13, Ui.INK, Ui.SORA_MED);
            tt.setSingleLine(true);
            tt.setEllipsize(android.text.TextUtils.TruncateAt.END);
            card.addView(tt, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 4)));
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(0, Ui.WRAP, 1f);
            if (i > 0) clp.leftMargin = Ui.dp(this, 8);
            upcomingRow.addView(card, clp);
        }
        for (int i = next.size(); i < 3 && next.size() > 0; i++) {
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(0, 1, 1f);
            clp.leftMargin = Ui.dp(this, 8);
            upcomingRow.addView(new View(this), clp);
        }

        // apps for this block
        appsLabel.setText(("Apps in " + p.name).toUpperCase(Locale.US));
        apps.removeAllViews();
        int added = 0;
        for (Apps.AppInfo a : Apps.launchable(this, false)) {
            if (added >= 9) break;
            boolean show = Apps.isEssential(this, a.pkg) && !a.pkg.contains("contacts") && !a.pkg.contains("deskclock") && !a.pkg.contains("photos");
            if (!show) {
                Integer m = p.modes.get(a.pkg);
                show = (s.pins.contains(a.pkg) && s.decide(this, a.pkg, now).mode == Store.ALLOW)
                        || (m != null && m == Store.ALLOW && s.modeIn(this, p, a.pkg) == Store.ALLOW)
                        || ("god".equals(p.id) && Apps.isRejoiceify(this, a.pkg));
            }
            if (!show) continue;
            apps.addView(appChip(a.label, a.pkg, god));
            added++;
        }
        TextView all = Ui.chip(this, "All apps →", god);
        all.setTextColor(Ui.MUTED);
        all.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Ui.open(HomeActivity.this, AppsActivity.class); }
        });
        apps.addView(all);

        // the main action
        boolean asleep = (cur.index < 0 || cur.title.toLowerCase(Locale.US).contains("sleep")) && s.minutesToUsualWake(now) <= 180;
        boolean morning = !s.dayStartedByTap(now) && now - s.anchor(now) < 3 * Store.HOUR;
        if (god) {
            action.setVisibility(View.VISIBLE);
            action.setText("Open Time with God");
            action.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { Ui.open(HomeActivity.this, GodActivity.class); }
            });
        } else if (asleep || morning) {
            action.setVisibility(View.VISIBLE);
            action.setText(asleep ? "I'm awake. Start my day" : "I just woke up. Start from now");
            action.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    s.wakeAt = System.currentTimeMillis();
                    s.save();
                    Ui.vibrate(HomeActivity.this);
                    render(true);
                }
            });
        } else {
            action.setVisibility(View.GONE);
        }

        if (entering) Ui.stagger(upcomingRow, appsLabel, apps, action);
    }

    private TextView appChip(String label, final String pkg, boolean gold) {
        TextView t = Ui.chip(this, label, gold);
        t.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openApp(HomeActivity.this, pkg); }
        });
        return t;
    }

    /** Opens an app, or the "Not now" screen when the block doesn't allow it. */
    public static void openApp(Activity a, String pkg) {
        Store.Decision d = Store.get(a).decide(a, pkg, System.currentTimeMillis());
        if (d.mode == Store.ALLOW) {
            Apps.launch(a, pkg);
            return;
        }
        Intent i = new Intent(a, BlockedActivity.class);
        i.putExtra("pkg", pkg);
        i.putExtra("kind", d.mode == Store.REASON ? "reason" : (d.entertainment ? "entertainment" : "block"));
        a.startActivity(i);
    }

    private static float hourOf(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.HOUR_OF_DAY) + c.get(Calendar.MINUTE) / 60f;
    }
}
