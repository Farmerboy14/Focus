package com.caleb.focus;

import android.app.Activity;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Paint;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** Time with God: the gold dial, today's verse, three small steps, and the Bible and journal close by. */
public class GodActivity extends Activity {
    private final Handler h = new Handler(Looper.getMainLooper());
    private DialView dial;
    private TextView big, sub, head, verse, ref;
    private boolean first = true;

    private final Runnable refresh = new Runnable() {
        @Override public void run() { render(false); h.postDelayed(this, 30_000); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        root.addView(new SkyView(this, true), new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 8), Ui.dp(this, 12));

        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setPadding(0, 0, 0, Ui.dp(this, 2));
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        head = Ui.mono(this, "", 12, 0xFFB4B7BE);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        hp.leftMargin = Ui.dp(this, 12);
        top.addView(head, hp);
        col.addView(top, Ui.lp(Ui.MATCH, Ui.WRAP));

        int sw = getResources().getDisplayMetrics().widthPixels;
        int shh = getResources().getDisplayMetrics().heightPixels;
        int size = Math.min(Math.min(sw - Ui.dp(this, 70), Ui.dp(this, 300)), (int) (shh * 0.34f));
        FrameLayout df = new FrameLayout(this);
        dial = new DialView(this, true);
        dial.setGlint(true);
        df.addView(dial, new FrameLayout.LayoutParams(size, size));
        LinearLayout center = Ui.column(this);
        center.setGravity(Gravity.CENTER);
        big = Ui.text(this, "", 60, Ui.INK, Ui.SORA_LIGHT);
        big.setLetterSpacing(-0.03f);
        big.setFontFeatureSettings("tnum");
        big.setGravity(Gravity.CENTER);
        big.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        sub = Ui.label(this, "");
        center.addView(big, Ui.lp(Ui.MATCH, Ui.WRAP));
        sub.setGravity(Gravity.CENTER);
        center.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        center.addView(Ui.text(this, "Time with God", 15, Ui.INK, Ui.SORA_MED), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 8)));
        df.addView(center, new FrameLayout.LayoutParams(size, size));
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(size, size);
        dlp.gravity = Gravity.CENTER_HORIZONTAL;
        dlp.topMargin = Ui.dp(this, 4);
        col.addView(df, dlp);

        verse = Ui.text(this, "", 20, 0xFFF4F2EC, Ui.NEWS_IT);
        verse.setGravity(Gravity.CENTER);
        verse.setLineSpacing(0, 1.18f);
        verse.setPadding(Ui.dp(this, 6), 0, Ui.dp(this, 6), 0);
        col.addView(verse, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 12)));
        ref = Ui.mono(this, "", 11, Ui.MUTED);
        ref.setGravity(Gravity.CENTER);
        ref.setLetterSpacing(0.1f);
        col.addView(ref, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));

        LinearLayout list = Ui.column(this);
        String[] steps = {"Read your Bible", "Pray: thanks, confession, requests", "Write one thing to carry into today"};
        final SharedPreferences sp = Store.get(this).prefs();
        final String day = Store.dayKey(System.currentTimeMillis());
        for (int i = 0; i < steps.length; i++) {
            final CheckBox cb = new CheckBox(this);
            cb.setText(steps[i]);
            cb.setTypeface(Ui.SORA);
            cb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            cb.setButtonTintList(ColorStateList.valueOf(Ui.GOLD_DEEP));
            cb.setMinHeight(Ui.dp(this, 42));
            final String key = "step_" + day + "_" + i;
            cb.setChecked(sp.getBoolean(key, false));
            styleStep(cb);
            cb.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                @Override public void onCheckedChanged(CompoundButton bt, boolean on) {
                    sp.edit().putBoolean(key, on).apply();
                    styleStep(cb);
                    if (on) Ui.vibrate(GodActivity.this);
                }
            });
            list.addView(cb, Ui.lp(Ui.MATCH, Ui.WRAP));
            if (i < steps.length - 1) {
                View ln = new View(this);
                ln.setBackgroundColor(0xFF1F2536);
                list.addView(ln, Ui.lp(Ui.MATCH, Math.max(1, Ui.dp(this, 1))));
            }
        }
        col.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));

        LinearLayout chips = Ui.row(this);
        TextView bible = Ui.chip(this, "KJV Bible", true);
        bible.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { Ui.open(GodActivity.this, BibleActivity.class); } });
        chips.addView(bible, new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP));
        TextView journal = Ui.chip(this, "Prayer journal", true);
        journal.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { Ui.open(GodActivity.this, JournalActivity.class); } });
        LinearLayout.LayoutParams jp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        jp.leftMargin = Ui.dp(this, 8);
        chips.addView(journal, jp);
        final String rj = Apps.rejoiceify(this);
        if (rj != null) {
            TextView music = Ui.chip(this, "Rejoiceify", true);
            music.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { Apps.launch(GodActivity.this, rj); } });
            LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
            mp.leftMargin = Ui.dp(this, 8);
            chips.addView(music, mp);
        }
        col.addView(chips, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 12)));
        TextView cap = Ui.text(this, "Everything else waits, Ledger and Robinhood too.", 12, Ui.MUTED, Ui.SORA);
        col.addView(cap, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 10)));

        col.addView(Ui.space(this));

        ImageView down = new ImageView(this);
        down.setImageResource(R.drawable.btn_putdown);
        down.setAdjustViewBounds(true);
        down.setScaleType(ImageView.ScaleType.FIT_CENTER);
        down.setContentDescription("Put the phone down");
        down.setClickable(true);
        Ui.press(down);
        down.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { Ui.open(GodActivity.this, RestActivity.class); } });
        LinearLayout.LayoutParams dp2 = new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP);
        dp2.leftMargin = -Ui.dp(this, 6);
        dp2.rightMargin = -Ui.dp(this, 6);
        col.addView(down, dp2);

        setContentView(root);
        Ui.stagger(top, verse, ref, list, chips, cap, down);
        Bible.load(this, new Runnable() { @Override public void run() { showVerse(); } });
    }

    private void styleStep(CheckBox cb) {
        cb.setTextColor(cb.isChecked() ? Ui.MUTED : Ui.INK);
        int f = cb.getPaintFlags();
        cb.setPaintFlags(cb.isChecked() ? f | Paint.STRIKE_THRU_TEXT_FLAG : f & ~Paint.STRIKE_THRU_TEXT_FLAG);
    }

    private void showVerse() {
        Bible.Ref r = Bible.verseOfDay(System.currentTimeMillis());
        verse.setText("“" + r.text + "”");
        ref.setText(("Today's verse · " + r.label() + " · KJV").toUpperCase(Locale.US));
    }

    @Override
    protected void onResume() {
        super.onResume();
        render(first);
        first = false;
        h.removeCallbacks(refresh);
        h.postDelayed(refresh, 30_000);
    }

    @Override
    protected void onPause() {
        h.removeCallbacks(refresh);
        super.onPause();
    }

    private void render(boolean animate) {
        long now = System.currentTimeMillis();
        Store s = Store.get(this);
        Store.Slot cur = s.current(now);
        boolean inBlock = "god".equals(cur.preset);
        head.setText(((inBlock ? "First hour awake · " : "Time with God · ") + Ui.clock(now)).toUpperCase(Locale.US));
        if (inBlock) {
            long left = cur.minutesLeft(now), len = cur.lengthMin();
            big.setText(Ui.hm(left));
            sub.setText(("of " + Ui.hm(len) + " left").toUpperCase(Locale.US));
            dial.setRemaining(left / (float) len, animate);
        } else {
            big.setText("Now");
            sub.setText("ANY TIME IS GOOD");
            dial.setRemaining(1f, animate);
        }
        java.util.List<Store.Slot> slots = s.slots(now);
        float[] hours = new float[slots.size()];
        java.util.Calendar c = java.util.Calendar.getInstance();
        for (int i = 0; i < slots.size(); i++) {
            c.setTimeInMillis(slots.get(i).start);
            hours[i] = c.get(java.util.Calendar.HOUR_OF_DAY) + c.get(java.util.Calendar.MINUTE) / 60f;
        }
        c.setTimeInMillis(now);
        dial.setStars(hours, c.get(java.util.Calendar.HOUR_OF_DAY) + c.get(java.util.Calendar.MINUTE) / 60f);
    }
}
