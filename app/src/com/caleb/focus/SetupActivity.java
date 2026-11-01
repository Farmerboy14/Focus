package com.caleb.focus;

import android.app.Activity;
import android.app.NotificationManager;
import android.app.role.RoleManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** The few switches Android needs flipped before Focus can do its job. */
public class SetupActivity extends Activity {
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, false);
        sky.setVeil(0.45f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        ScrollView sc = new ScrollView(this);
        sc.setVerticalScrollBarEnabled(false);
        sc.setClipToPadding(false);
        root.addView(sc, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        LinearLayout col = Ui.column(this);
        sc.addView(col);
        Ui.edgeToEdge(this, sc, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 24));
        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        col.addView(top);
        col.addView(Ui.text(this, "Setup", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        TextView sub = Ui.text(this, "Do these in order. Each one opens the right Android screen; come back here when you're done.", 13, Ui.MUTED, Ui.SORA);
        sub.setLineSpacing(0, 1.3f);
        col.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        list = Ui.column(this);
        col.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private boolean isHome() {
        try {
            RoleManager rm = (RoleManager) getSystemService(ROLE_SERVICE);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_HOME);
        } catch (Throwable t) { return false; }
    }

    private boolean dndOk() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    private void render() {
        list.removeAllViews();
        final boolean on = FocusService.isOn(this);
        step("1", "Make Focus your home screen", "So the home button always brings you here.", isHome(), new Runnable() {
            @Override public void run() {
                try {
                    RoleManager rm = (RoleManager) getSystemService(ROLE_SERVICE);
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), 7);
                } catch (Throwable t) {
                    startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
                }
            }
        });
        step("2", "Allow restricted settings", "Android blocks app blocking for apps installed from a file until you allow it. On the App info screen tap ⋮ (top right), then “Allow restricted settings”. If you don't see it, skip to step 3 first, try to turn it on, then come back.", on, new Runnable() {
            @Override public void run() {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            }
        });
        step("3", "Turn on app blocking", "Open Accessibility, tap “Focus app blocking” (it may be under Downloaded apps), and turn it on.", on, new Runnable() {
            @Override public void run() { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
        });
        step("4", "Let Focus turn on Do Not Disturb", "Find Focus in the list and allow it. Strict blocks and Time with God silence notifications.", dndOk(), new Runnable() {
            @Override public void run() { startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); }
        });

        list.addView(Ui.label(this, "Good to know"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        TextView n = Ui.text(this, "Settings always stays open, so you can never lock yourself out. To pause Focus, turn off app blocking in Accessibility.\n\nRejoiceify is allowed during Time with God once it's installed.", 13, Ui.MUTED, Ui.SORA);
        n.setLineSpacing(0, 1.35f);
        list.addView(n, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        String crash = Store.get(this).prefs().getString("lastCrash", null);
        if (crash != null) {
            list.addView(Ui.label(this, "Last problem"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
            TextView c = Ui.text(this, crash, 10, Ui.QUIET, Ui.MONO);
            c.setTextIsSelectable(true);
            list.addView(c, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
            TextView clear = Ui.plain(this, "Clear", Ui.MUTED);
            clear.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { Store.get(SetupActivity.this).prefs().edit().remove("lastCrash").apply(); render(); }
            });
            list.addView(clear);
        }
        LinearLayout lr = Ui.row(this);
        TextView lt = Ui.text(this, "Focus lock screen", 15, Ui.INK, Ui.SORA);
        lr.addView(lt, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        android.widget.Switch ls = new android.widget.Switch(this);
        ls.setChecked(LockActivity.enabled(this));
        ls.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(android.widget.CompoundButton b, boolean on) {
                Store.get(SetupActivity.this).prefs().edit().putBoolean("lockScreen", on).apply();
            }
        });
        lr.addView(ls);
        list.addView(lr, Ui.lp(Ui.MATCH, Ui.dp(this, 52), Ui.dp(this, 8)));
        TextView lnote = Ui.text(this, "Shows your block, what's next and today's verse when you wake the phone. Swipe up, then unlock as usual. Needs app blocking on.", 12, Ui.MUTED, Ui.SORA);
        lnote.setLineSpacing(0, 1.3f);
        list.addView(lnote, Ui.lp(Ui.MATCH, Ui.WRAP));

        TextView wall = Ui.chip(this, "Use the Focus night sky on home and lock screen", false);
        wall.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                HomeActivity.matchWallpaper(SetupActivity.this, true);
                android.widget.Toast.makeText(SetupActivity.this, "Wallpaper set.", android.widget.Toast.LENGTH_SHORT).show();
            }
        });
        list.addView(wall, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 12)));

        list.addView(Ui.label(this, "Updates"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        final TextView upd = Ui.goldButton(this, "Check for updates");
        upd.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Updater.Info a = Updater.available();
                if (a != null) { Updater.install(SetupActivity.this, a); return; }
                upd.setText("Checking…");
                Updater.check(SetupActivity.this, true, new Updater.Callback() {
                    @Override public void done(Updater.Info newer, String error) {
                        if (error != null) upd.setText(error);
                        else if (newer == null) upd.setText("You have the newest version");
                        else upd.setText("Install Focus " + newer.name);
                    }
                });
            }
        });
        list.addView(upd, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        TextView ver = Ui.mono(this, "Focus " + Updater.installedName(this), 10, 0xFF5E5B55);
        list.addView(ver, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 20)));
    }

    private void step(String num, String title, String body, boolean done, final Runnable go) {
        LinearLayout row = Ui.column(this);
        row.setBackground(new Ui.StoneDrawable(this, Ui.STONE, done ? 0x14FFFFFF : 0x4DF2D38A, 18));
        row.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        LinearLayout h = Ui.row(this);
        h.addView(Ui.mono(this, done ? "Done" : "Step " + num, 11, done ? Ui.MUTED : Ui.GOLD));
        row.addView(h);
        row.addView(Ui.text(this, title, 17, done ? Ui.MUTED : Ui.INK, Ui.SORA_MED), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
        TextView t = Ui.text(this, body, 13, Ui.MUTED, Ui.SORA);
        t.setLineSpacing(0, 1.3f);
        row.addView(t, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        row.setClickable(true);
        Ui.press(row);
        row.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { try { go.run(); } catch (Throwable ignored) { } }
        });
        list.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
    }
}
