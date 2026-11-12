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
    private TextView clock, pill, big, sub, title, appsLabel, noteView;
    private LinearLayout upcomingRow, banner, updBanner;
    private TextView updText;
    private FlowLayout apps;
    private LinearLayout dock;
    private int themeAt;
    private TextView action;
    private String shownKey = "";
    private long undoUntil;

    private final Runnable refresh = new Runnable() {
        @Override public void run() { render(false); h.postDelayed(this, 30_000); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        themeAt = Theme.version(this);
        Ui.init(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        sky = new SkyView(this, false);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 10), 0);

        LinearLayout head = Ui.row(this);
        // a little globe: the Earth right now
        android.widget.ImageView globe = new android.widget.ImageView(this);
        globe.setImageDrawable(new GlobeGlyph(this));
        globe.setContentDescription("The Earth right now");
        globe.setClickable(true);
        Ui.press(globe);
        globe.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { Ui.open(HomeActivity.this, EarthActivity.class); }
        });
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(Ui.dp(this, 32), Ui.dp(this, 32));
        glp.rightMargin = Ui.dp(this, 10);
        head.addView(globe, glp);
        clock = Ui.mono(this, "", 12, 0xFFB4B7BE);
        head.addView(clock);
        head.addView(Ui.space(this));
        pill = Ui.stone(this, "", Ui.ICE_SOFT, Ui.ice(0x29), 999, 12);
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
        int dialSize = Math.min(Math.min(sw - Ui.dp(this, 40), Ui.dp(this, 320)), (int) (getResources().getDisplayMetrics().heightPixels * 0.36f));
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

        noteView = Ui.text(this, "", 14, 0xFFC9CCD2, Ui.SORA);
        noteView.setGravity(Gravity.CENTER);
        noteView.setLineSpacing(0, 1.3f);
        noteView.setMaxLines(3);
        noteView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        noteView.setPadding(Ui.dp(this, 8), 0, Ui.dp(this, 8), 0);
        col.addView(noteView, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        upcomingRow = Ui.row(this);
        col.addView(upcomingRow, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));

        appsLabel = Ui.label(this, "");
        col.addView(appsLabel, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 18)));
        apps = new FlowLayout(this, Ui.dp(this, 8));
        col.addView(apps, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        col.addView(Ui.space(this));

        action = Ui.goldButton(this, "");
        col.addView(action, Ui.lp(Ui.MATCH, Ui.WRAP));

        // favorite apps, always in the same place
        dock = Ui.column(this);
        col.addView(dock, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));

        LinearLayout nav = Ui.row(this);
        nav.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 4));
        nav.addView(navItem("Today", ScheduleActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("All apps", AppsActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("Presets", PresetsActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        nav.addView(navItem("Setup", SetupActivity.class), new LinearLayout.LayoutParams(0, Ui.dp(this, 48), 1f));
        View line = new View(this);
        line.setBackgroundColor(Ui.ice(0x24));
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
                    android.graphics.Bitmap b = Theme.fall(c) && Theme.hasPhoto(c) ? Theme.photo(c)
                            : android.graphics.BitmapFactory.decodeResource(c.getResources(), R.drawable.sky_night);
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
        if (themeAt != Theme.version(this)) { recreate(); return; }   // a new theme or photo: build the screen again
        render(true);
        Sync.ensure(this);
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
        pill.setBackground(new Ui.StoneDrawable(this, Ui.STONE, god ? Ui.BORDER_GOLD : Ui.ice(0x29), 999));
        banner.setVisibility(FocusService.isOn(this) ? View.GONE : View.VISIBLE);
        sky.setDawn(god);
        dial.setGold(god);
        dial.setGlint(god);

        long left = cur.minutesLeft(now);
        long len = cur.lengthMin();
        big.setText(Ui.hm(left));
        sub.setText(("of " + Ui.hm(len) + " left").toUpperCase(Locale.US));
        title.setText(cur.index < 0 ? "Open time · until " + Ui.clock(cur.end) : cur.title);
        noteView.setText(cur.note);
        noteView.setVisibility(cur.note == null || cur.note.isEmpty() ? View.GONE : View.VISIBLE);

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
            card.setBackground(new Ui.StoneDrawable(this, Ui.STONE, Ui.ice(0x1A), 16));
            card.setPadding(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 12), Ui.dp(this, 10));
            card.addView(Ui.text(this, Ui.clock(n.start), 11, Ui.MUTED, Ui.MONO));
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

        // apps for this block (favorites have their own place below)
        appsLabel.setText(("Apps in " + p.name).toUpperCase(Locale.US));
        apps.removeAllViews();
        int added = 0;
        for (Apps.AppInfo a : Apps.launchable(this, false)) {
            if (added >= 9) break;
            if (s.favs.contains(a.pkg)) continue;
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

        renderDock(s, now, god);

        // the main action
        if (god) {
            action.setVisibility(View.VISIBLE);
            action.setText("Open Time with God");
            action.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { Ui.open(HomeActivity.this, GodActivity.class); }
            });
        } else {
            action.setVisibility(View.GONE);
        }

        if (entering) Ui.stagger(noteView, upcomingRow, appsLabel, apps, action, dock);
    }

    /** Favorites: five to a row, line icons on stone. One the block doesn't allow is dimmed and opens "Not now". */
    private void renderDock(final Store s, long now, boolean god) {
        dock.removeAllViews();
        List<String> favs = new java.util.ArrayList<>();
        java.util.Map<String, String> labels = new java.util.HashMap<>();
        for (Apps.AppInfo a : Apps.launchable(this, false)) labels.put(a.pkg, a.label);
        for (String f : s.favs) if (labels.containsKey(f)) favs.add(f);
        int cells = favs.size() < 5 ? favs.size() + 1 : favs.size();   // a "+" until the first row is full
        LinearLayout row = null;
        for (int i = 0; i < cells; i++) {
            if (i % 5 == 0) {
                row = Ui.row(this);
                row.setGravity(Gravity.TOP);
                dock.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, i == 0 ? 0 : Ui.dp(this, 10)));
            }
            View cell = i < favs.size() ? favCell(favs.get(i), labels.get(favs.get(i)), s.decide(this, favs.get(i), now).mode == Store.ALLOW, god)
                    : addCell(god);
            row.addView(cell, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        }
        if (row != null) for (int i = cells % 5; i > 0 && i < 5; i++) row.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        Icons.load(this, new Runnable() { @Override public void run() { for (int i = 0; i < dock.getChildCount(); i++) invalidateAll(dock.getChildAt(i)); } });
    }

    private static void invalidateAll(View v) {
        v.invalidate();
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) invalidateAll(((ViewGroup) v).getChildAt(i));
    }

    private LinearLayout cellShell(android.graphics.drawable.Drawable icon, String label, boolean on) {
        LinearLayout cell = Ui.column(this);
        cell.setGravity(Gravity.CENTER_HORIZONTAL);
        cell.setClickable(true);
        cell.setFocusable(true);
        Ui.press(cell);
        android.widget.ImageView iv = new android.widget.ImageView(this);
        iv.setImageDrawable(icon);
        iv.setAlpha(on ? 1f : 0.38f);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(Ui.dp(this, 52), Ui.dp(this, 52));
        ip.gravity = Gravity.CENTER_HORIZONTAL;
        cell.addView(iv, ip);
        TextView t = Ui.text(this, label, 11, on ? 0xFFC9CCD2 : Ui.QUIET, Ui.SORA);
        t.setSingleLine(true);
        t.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.setGravity(Gravity.CENTER);
        t.setPadding(Ui.dp(this, 2), 0, Ui.dp(this, 2), 0);
        cell.addView(t, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        cell.setContentDescription(label + (on ? "" : ", not now"));
        return cell;
    }

    private View favCell(final String pkg, final String label, boolean on, boolean god) {
        android.graphics.drawable.Drawable d = Icons.of(this, pkg, label, true, god);
        LinearLayout cell = cellShell(d, label, on);
        cell.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openApp(HomeActivity.this, pkg); }
        });
        cell.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { favOptions(pkg, label); return true; }
        });
        return cell;
    }

    private View addCell(boolean god) {
        android.graphics.drawable.Drawable plus = new android.graphics.drawable.Drawable() {
            final android.graphics.Paint pt = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
            @Override public void draw(android.graphics.Canvas c) {
                android.graphics.Rect b = getBounds();
                float r = Math.min(b.width(), b.height()) / 2f, cx = b.exactCenterX(), cy = b.exactCenterY();
                pt.setStyle(android.graphics.Paint.Style.STROKE);
                pt.setStrokeWidth(Math.max(1f, r / 32f));
                pt.setColor(Ui.ice(0x33));
                pt.setPathEffect(new android.graphics.DashPathEffect(new float[]{r / 6f, r / 8f}, 0));
                c.drawCircle(cx, cy, r - pt.getStrokeWidth(), pt);
                pt.setPathEffect(null);
                pt.setStrokeCap(android.graphics.Paint.Cap.ROUND);
                pt.setStrokeWidth(Math.max(1.5f, r / 14f));
                pt.setColor(Ui.MUTED);
                c.drawLine(cx - r * 0.28f, cy, cx + r * 0.28f, cy, pt);
                c.drawLine(cx, cy - r * 0.28f, cx, cy + r * 0.28f, pt);
            }
            @Override public void setAlpha(int a) { }
            @Override public void setColorFilter(android.graphics.ColorFilter f) { }
            @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
        };
        LinearLayout cell = cellShell(plus, "Add", true);
        ((TextView) cell.getChildAt(1)).setTextColor(Ui.QUIET);
        cell.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Intent i = new Intent(HomeActivity.this, AppsActivity.class);
                i.putExtra("pick", true);
                startActivity(i);
            }
        });
        return cell;
    }

    private void favOptions(final String pkg, String label) {
        final Store s = Store.get(this);
        final int at = s.favs.indexOf(pkg);
        final List<String> items = new java.util.ArrayList<>();
        if (at > 0) items.add("Move left");
        if (at >= 0 && at < s.favs.size() - 1) items.add("Move right");
        if (s.favs.size() < Store.MAX_FAVS) items.add("Add another app");
        items.add("Remove from home screen");
        items.add("App info");
        new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(label)
                .setItems(items.toArray(new String[0]), new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int which) {
                        String it = items.get(which);
                        int i = s.favs.indexOf(pkg);
                        if (it.equals("Move left") && i > 0) { s.favs.remove(i); s.favs.add(i - 1, pkg); }
                        else if (it.equals("Move right") && i >= 0 && i < s.favs.size() - 1) { s.favs.remove(i); s.favs.add(i + 1, pkg); }
                        else if (it.equals("Remove from home screen")) s.favs.remove(pkg);
                        else if (it.equals("Add another app")) {
                            Intent pick = new Intent(HomeActivity.this, AppsActivity.class);
                            pick.putExtra("pick", true);
                            startActivity(pick);
                            return;
                        } else if (it.equals("App info")) {
                            startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + pkg)));
                            return;
                        }
                        s.save();
                        render(false);
                    }
                }).show();
    }

    /** A line-drawn globe on a stone disc, in the night icons' style. */
    static final class GlobeGlyph extends android.graphics.drawable.Drawable {
        private final android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final android.graphics.RectF r = new android.graphics.RectF();
        GlobeGlyph(android.content.Context c) { }
        @Override public void draw(android.graphics.Canvas c) {
            android.graphics.Rect b = getBounds();
            float s = Math.min(b.width(), b.height()), cx = b.exactCenterX(), cy = b.exactCenterY();
            p.setStyle(android.graphics.Paint.Style.FILL);
            p.setColor(0xD90B1019);
            c.drawCircle(cx, cy, s / 2f, p);
            p.setStyle(android.graphics.Paint.Style.STROKE);
            p.setStrokeWidth(Math.max(1f, s / 64f));
            p.setColor(Ui.ice(0x2E));
            c.drawCircle(cx, cy, s / 2f - p.getStrokeWidth() / 2f, p);
            float g = s * 0.30f;
            p.setColor(Ui.ICE_SOFT);
            p.setStrokeWidth(s * 0.045f);
            p.setStrokeCap(android.graphics.Paint.Cap.ROUND);
            c.drawCircle(cx, cy, g, p);
            r.set(cx - g * 0.45f, cy - g, cx + g * 0.45f, cy + g);
            c.drawOval(r, p);
            c.drawLine(cx - g, cy, cx + g, cy, p);
        }
        @Override public void setAlpha(int a) { }
        @Override public void setColorFilter(android.graphics.ColorFilter f) { }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
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
