package com.caleb.focus;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.TimePickerDialog;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.TimePicker;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** The week: pick a day, see its blocks with clock times, tap one to change it. */
public class ScheduleActivity extends Activity {
    private LinearLayout list, tabs;
    private TextView sub;
    private int day; // 0 = Sunday
    private int today;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        today = Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1;
        day = today;
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
        col.addView(Ui.text(this, "Your week", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        sub = Ui.text(this, "", 13, Ui.MUTED, Ui.SORA);
        sub.setLineSpacing(0, 1.3f);
        col.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        tabs = Ui.row(this);
        hs.addView(tabs);
        col.addView(hs, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));

        list = Ui.column(this);
        col.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));

        TextView add = Ui.goldButton(this, "Add a block");
        add.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { edit(-1); } });
        col.addView(add, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));
        TextView copy = Ui.plain(this, "Copy this day to Monday–Friday", Ui.MUTED);
        copy.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { copyToWeekdays(); } });
        col.addView(copy, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        TextView reset = Ui.plain(this, "Reset the whole week to the plan", Ui.QUIET);
        reset.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                new AlertDialog.Builder(ScheduleActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                        .setMessage("Replace every day with the schedule we planned together?")
                        .setPositiveButton("Replace", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface d, int w) {
                                Store s = Store.get(ScheduleActivity.this);
                                s.defaultWeek();
                                s.scheduleChanged();
                                render();
                            }
                        }).setNegativeButton("Cancel", null).show();
            }
        });
        col.addView(reset, Ui.lp(Ui.MATCH, Ui.WRAP));
        setContentView(root);
        render();
        Ui.stagger(list);
    }

    private void render() {
        Store s = Store.get(this);
        long now = System.currentTimeMillis();
        sub.setText("Blocks follow the clock, and your phone and PC switch with them. Tap a block to change it.");

        tabs.removeAllViews();
        for (int i = 0; i < 7; i++) {
            final int d = (1 + i) % 7; // Monday first, Sunday last
            String label = Store.DAY_NAMES[d].substring(0, 3) + (d == today ? " ·" : "");
            TextView t = Ui.chip(this, label, d == day);
            t.setTextColor(d == day ? Ui.GOLD : Ui.MUTED);
            t.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { day = d; render(); Ui.stagger(list); } });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
            if (i > 0) lp.leftMargin = Ui.dp(this, 6);
            tabs.addView(t, lp);
        }

        list.removeAllViews();
        Store.Slot cur = s.current(now);
        List<Store.TBlock> blocks = s.week.get(day);
        for (int i = 0; i < blocks.size(); i++) {
            final int idx = i;
            Store.TBlock b = blocks.get(i);
            boolean isNow = day == cur.day && cur.index == i;
            boolean god = "god".equals(b.preset);
            LinearLayout row = Ui.row(this);
            row.setGravity(Gravity.TOP);
            row.setBackground(new Ui.StoneDrawable(this, Ui.STONE, isNow ? (god ? 0x66F2D38A : Ui.ice(0x66)) : 0x14FFFFFF, 18));
            row.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
            LinearLayout left = Ui.column(this);
            left.addView(Ui.mono(this, clock(b.start) + "–" + clock(b.end), 11, isNow ? (god ? Ui.GOLD : Ui.ICE) : Ui.MUTED));
            left.addView(Ui.text(this, b.title, 17, Ui.INK, Ui.SORA_MED), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
            if (!b.note.isEmpty()) {
                TextView n = Ui.text(this, b.note, 13, 0xFFC9CCD2, Ui.SORA);
                n.setLineSpacing(0, 1.25f);
                left.addView(n, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));
            }
            left.addView(Ui.text(this, s.presetName(b.preset), 12, Ui.QUIET, Ui.SORA), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
            row.addView(left, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            if (isNow) row.addView(Ui.mono(this, "Now", 11, god ? Ui.GOLD : Ui.ICE));
            row.setClickable(true);
            Ui.press(row);
            row.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { edit(idx); } });
            list.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, list.getChildCount() == 0 ? 0 : Ui.dp(this, 8)));
        }
        if (blocks.isEmpty()) {
            list.addView(Ui.text(this, "Nothing planned for " + Store.DAY_NAMES[day] + " yet.", 14, Ui.MUTED, Ui.SORA));
        }
    }

    private static String clock(int m) {
        int h = (m / 60) % 24, mm = m % 60;
        String ap = h < 12 ? "AM" : "PM";
        int h12 = h % 12 == 0 ? 12 : h % 12;
        return h12 + ":" + String.format(Locale.US, "%02d", mm) + " " + ap;
    }

    private void edit(final int index) {
        final Store s = Store.get(this);
        final List<Store.TBlock> blocks = s.week.get(day);
        final boolean isNew = index < 0 || index >= blocks.size();
        final Store.TBlock orig = isNew ? null : blocks.get(index);
        int startGuess = blocks.isEmpty() ? 9 * 60 : blocks.get(blocks.size() - 1).end;
        final Store.TBlock blk = isNew ? new Store.TBlock(startGuess, (startGuess + 60) % 1440, "", "work", "") : orig.copy();

        LinearLayout v = Ui.column(this);
        v.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);
        final EditText name = new EditText(this);
        name.setHint("Title, like Ledger: deep work");
        name.setText(blk.title);
        name.setSingleLine(true);
        name.setTextColor(Ui.INK);
        name.setTypeface(Ui.SORA);
        v.addView(name, Ui.lp(Ui.MATCH, Ui.WRAP));
        final EditText note = new EditText(this);
        note.setHint("What to do in this block");
        note.setText(blk.note);
        note.setTextColor(Ui.INK);
        note.setTypeface(Ui.SORA);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        v.addView(note, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 4)));

        LinearLayout times = Ui.row(this);
        final TextView startBtn = Ui.chip(this, "Starts " + clock(blk.start), false);
        final TextView endBtn = Ui.chip(this, "Ends " + clock(blk.end), false);
        startBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View x) {
                new TimePickerDialog(ScheduleActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert, new TimePickerDialog.OnTimeSetListener() {
                    @Override public void onTimeSet(TimePicker tp, int h, int m) { blk.start = h * 60 + m; startBtn.setText("Starts " + clock(blk.start)); }
                }, blk.start / 60, blk.start % 60, false).show();
            }
        });
        endBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View x) {
                new TimePickerDialog(ScheduleActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert, new TimePickerDialog.OnTimeSetListener() {
                    @Override public void onTimeSet(TimePicker tp, int h, int m) { blk.end = h * 60 + m; endBtn.setText("Ends " + clock(blk.end)); }
                }, blk.end / 60, blk.end % 60, false).show();
            }
        });
        times.addView(startBtn);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        ep.leftMargin = Ui.dp(this, 8);
        times.addView(endBtn, ep);
        v.addView(times, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 12)));

        v.addView(Ui.label(this, "Preset"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 14)));
        final RadioGroup rg = new RadioGroup(this);
        for (int i = 0; i < Store.PRESET_IDS.length; i++) {
            RadioButton rb = new RadioButton(this);
            rb.setId(1000 + i);
            rb.setText(s.presetName(Store.PRESET_IDS[i]));
            rb.setTypeface(Ui.SORA);
            rb.setTextColor(Ui.INK);
            rb.setButtonTintList(ColorStateList.valueOf(Ui.GOLD));
            rg.addView(rb);
            if (Store.PRESET_IDS[i].equals(blk.preset)) rb.setChecked(true);
        }
        v.addView(rg);
        final boolean weekday = day >= 1 && day <= 5;
        final CheckBox all = new CheckBox(this);
        all.setText("Change it on every weekday (Mon–Fri)");
        all.setTypeface(Ui.SORA);
        all.setTextColor(Ui.INK);
        all.setButtonTintList(ColorStateList.valueOf(Ui.GOLD));
        if (weekday && !isNew) v.addView(all, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 8)));
        ScrollView sv = new ScrollView(this);
        sv.addView(v);

        AlertDialog.Builder bld = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(isNew ? "New block on " + Store.DAY_NAMES[day] : "Edit block")
                .setView(sv)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        int sel = rg.getCheckedRadioButtonId() - 1000;
                        if (sel >= 0 && sel < Store.PRESET_IDS.length) blk.preset = Store.PRESET_IDS[sel];
                        String t = name.getText().toString().trim();
                        blk.title = t.isEmpty() ? s.presetName(blk.preset) : t;
                        blk.note = note.getText().toString().trim();
                        if (isNew) {
                            blocks.add(blk);
                        } else if (all.isChecked() && weekday) {
                            for (int dd = 1; dd <= 5; dd++) {
                                List<Store.TBlock> other = s.week.get(dd);
                                for (int k = 0; k < other.size(); k++) {
                                    Store.TBlock ob = other.get(k);
                                    if (ob.start == orig.start && ob.title.equals(orig.title)) other.set(k, blk.copy());
                                }
                                Store.sortDay(other);
                            }
                        } else {
                            blocks.set(index, blk);
                        }
                        Store.sortDay(blocks);
                        s.scheduleChanged();
                        render();
                    }
                })
                .setNegativeButton("Cancel", null);
        if (!isNew) {
            bld.setNeutralButton("Delete", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    blocks.remove(index);
                    s.scheduleChanged();
                    render();
                }
            });
        }
        bld.show();
    }

    private void copyToWeekdays() {
        final Store s = Store.get(this);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setMessage("Make Monday through Friday the same as " + Store.DAY_NAMES[day] + "?")
                .setPositiveButton("Copy", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        List<Store.TBlock> src = s.week.get(day);
                        for (int dd = 1; dd <= 5; dd++) {
                            if (dd == day) continue;
                            List<Store.TBlock> c = new ArrayList<>();
                            for (Store.TBlock b : src) c.add(b.copy());
                            s.week.set(dd, c);
                        }
                        s.scheduleChanged();
                        render();
                    }
                }).setNegativeButton("Cancel", null).show();
    }
}
