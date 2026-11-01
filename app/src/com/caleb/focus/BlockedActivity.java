package com.caleb.focus;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** "Not now." An obsidian slab that rises over home when an app isn't part of this block. */
public class BlockedActivity extends Activity {
    private LinearLayout slab;
    private String pkg, kind;
    private EditText reason;
    private TextView openBtn;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        build();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        build();
    }

    private void build() {
        pkg = getIntent().getStringExtra("pkg");
        kind = getIntent().getStringExtra("kind");
        if (pkg == null) { finish(); return; }
        if (kind == null) kind = "block";
        Store s = Store.get(this);
        long now = System.currentTimeMillis();
        Store.Slot cur = s.current(now);
        Store.Preset p = s.currentPreset(now);
        String label = "youtube".equals(kind) ? "YouTube in Chrome" : Apps.label(this, pkg);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, "god".equals(p.id));
        sky.setVeil(0.5f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        View scrim = new View(this);
        scrim.setClickable(true);
        scrim.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { goHome(); } });
        root.addView(scrim, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        slab = Ui.column(this);
        slab.setBackground(new Ui.StoneDrawable(this, 0xFF0A0C12, 0x14FFFFFF, 30));
        slab.setClickable(true);
        FrameLayout.LayoutParams sl = new FrameLayout.LayoutParams(Ui.MATCH, Ui.WRAP, Gravity.BOTTOM);
        sl.bottomMargin = -Ui.dp(this, 40);
        root.addView(slab, sl);
        final int side = Ui.dp(this, 24);
        slab.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(View v, android.view.WindowInsets in) {
                int bottom = Math.max(in.getInsets(android.view.WindowInsets.Type.ime()).bottom, in.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom);
                v.setPadding(side, Ui.dp(BlockedActivity.this, 14), side, bottom + Ui.dp(BlockedActivity.this, 68));
                return in;
            }
        });
        getWindow().setDecorFitsSystemWindows(false);

        View grab = new View(this);
        grab.setBackgroundColor(0x2EFFFFFF);
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(Ui.dp(this, 36), Ui.dp(this, 4));
        gp.gravity = Gravity.CENTER_HORIZONTAL;
        gp.bottomMargin = Ui.dp(this, 22);
        slab.addView(grab, gp);

        String tag = "youtube".equals(kind) ? "Video" : "entertainment".equals(kind) ? "Entertainment" : p.name;
        TextView top = Ui.mono(this, label + " · " + tag, 11, Ui.MUTED);
        top.setLetterSpacing(0.14f);
        TextView big = Ui.text(this, "Not now.", 44, Ui.INK, Ui.SORA_LIGHT);
        big.setLetterSpacing(-0.04f);
        TextView msg = Ui.text(this, message(s, p, label, now), 15, 0xFFC9CCD2, Ui.SORA);
        msg.setLineSpacing(0, 1.35f);
        TextView nowLine = Ui.mono(this, "Now · " + cur.title + " · until " + Ui.clock(cur.end), 11, Ui.GOLD_DEEP);
        nowLine.setLetterSpacing(0.1f);
        slab.addView(top);
        slab.addView(big, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 10)));
        slab.addView(msg, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));
        slab.addView(nowLine, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 14)));

        View reasonBox = null;
        if ("reason".equals(kind)) {
            LinearLayout box = Ui.column(this);
            reason = new EditText(this);
            reason.setHint("Why do you need it right now?");
            reason.setHintTextColor(Ui.QUIET);
            reason.setTextColor(Ui.INK);
            reason.setTypeface(Ui.NEWS);
            reason.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
            reason.setMinLines(2);
            reason.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
            reason.setBackground(new Ui.StoneDrawable(this, Ui.STONE, 0x29F2D38A, 16));
            box.addView(reason, Ui.lp(Ui.MATCH, Ui.WRAP));
            openBtn = Ui.stone(this, "Open for 10 minutes", Ui.INK, 0x1FFFFFFF, 16, 15);
            openBtn.setMinHeight(Ui.dp(this, 50));
            openBtn.setEnabled(false);
            openBtn.setAlpha(0.45f);
            openBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    Store.get(BlockedActivity.this).grantPass(pkg, 10, reason.getText().toString().trim());
                    Ui.vibrate(BlockedActivity.this);
                    Apps.launch(BlockedActivity.this, pkg);
                    finish();
                }
            });
            box.addView(openBtn, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));
            reason.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence c, int a, int b2, int d) { }
                @Override public void onTextChanged(CharSequence c, int a, int b2, int d) { }
                @Override public void afterTextChanged(Editable e) {
                    String t = e.toString().trim();
                    boolean ok = t.length() >= 15 && t.split("\\s+").length >= 4;
                    openBtn.setEnabled(ok);
                    openBtn.setAlpha(ok ? 1f : 0.45f);
                }
            });
            slab.addView(box, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 18)));
            reasonBox = box;
        }

        TextView backBtn = Ui.goldButton(this, "god".equals(p.id) ? "Open Time with God instead" : "Back to " + cur.title);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if ("god".equals(cur(BlockedActivity.this))) {
                    startActivity(new Intent(BlockedActivity.this, GodActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    finish();
                } else goHome();
            }
        });
        slab.addView(backBtn, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 24)));
        TextView close = Ui.plain(this, "Close", Ui.MUTED);
        close.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { goHome(); } });
        slab.addView(close, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));

        setContentView(root);
        Ui.vibrate(this);
        slab.setTranslationY(getResources().getDisplayMetrics().heightPixels * 0.7f);
        slab.animate().translationY(0).setDuration(680).setStartDelay(40).setInterpolator(new OvershootInterpolator(0.9f)).start();
        sky.setAlpha(0f);
        sky.animate().alpha(1f).setDuration(380).setInterpolator(new DecelerateInterpolator()).start();
        Ui.stagger(top, big, msg, nowLine, reasonBox, backBtn, close);
    }

    private static String cur(Activity a) {
        return Store.get(a).current(System.currentTimeMillis()).preset;
    }

    private String message(Store s, Store.Preset p, String label, long now) {
        if ("youtube".equals(kind)) {
            return "You've used today's " + s.ytLimitMin + " minutes of YouTube in Chrome. It opens again in Free time.";
        }
        if ("entertainment".equals(kind)) {
            long free = s.nextFree(now);
            return "Entertainment opens in Free time. " + (free > 0 ? "The next one starts at " + Ui.clock(free) + "." : "There's no Free time left today.");
        }
        if ("reason".equals(kind)) {
            return label + " needs a reason during " + p.name + ". Write one sentence about why you need it.";
        }
        return label + " isn't part of " + p.name + ". You can change that in Presets.";
    }

    private void goHome() {
        slab.animate().translationY(slab.getHeight() + Ui.dp(this, 60)).setStartDelay(0).setDuration(300)
                .setInterpolator(new android.view.animation.AccelerateInterpolator()).withEndAction(new Runnable() {
                    @Override public void run() {
                        Intent h = new Intent(Intent.ACTION_MAIN);
                        h.addCategory(Intent.CATEGORY_HOME);
                        h.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(h); } catch (Throwable ignored) { }
                        finish();
                        overridePendingTransition(0, R.anim.fade_out);
                    }
                }).start();
    }

    @Override
    public void onBackPressed() { goHome(); }


    static String upper(String s) { return s.toUpperCase(Locale.US); }
}
