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
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.TimePicker;

import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** Today: blocks laid end to end from the moment you wake up. Tap a block to change it. */
public class ScheduleActivity extends Activity {
    private LinearLayout list;
    private TextView sub, wakeBtn, woke;

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
        col.addView(Ui.text(this, "Today", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        sub = Ui.text(this, "", 13, Ui.MUTED, Ui.SORA);
        sub.setLineSpacing(0, 1.3f);
        col.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));

        LinearLayout btns = Ui.row(this);
        woke = Ui.chip(this, "I just woke up", true);
        woke.setTextColor(Ui.GOLD);
        woke.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Store s = Store.get(ScheduleActivity.this);
                if (s.dayStartedByTap(System.currentTimeMillis())) s.undoWake();
                else s.wakeNow();
                Ui.vibrate(ScheduleActivity.this);
                render();
            }
        });
        btns.addView(woke);
        wakeBtn = Ui.chip(this, "", false);
        wakeBtn.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { pickWake(); } });
        LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        wp.leftMargin = Ui.dp(this, 8);
        btns.addView(wakeBtn, wp);
        col.addView(btns, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));

        list = Ui.column(this);
        col.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 18)));

        TextView add = Ui.goldButton(this, "Add a block");
        add.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { edit(-1); } });
        col.addView(add, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));
        TextView reset = Ui.plain(this, "Reset to the starter day", Ui.MUTED);
        reset.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                new AlertDialog.Builder(ScheduleActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                        .setMessage("Replace your blocks with the starter day?")
                        .setPositiveButton("Replace", new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface d, int w) {
                                Store s = Store.get(ScheduleActivity.this);
                                s.blocks.clear();
                                s.blocks.add(new Store.Block("Time with God", "god", 30));
                                s.blocks.add(new Store.Block("Get ready", "strict", 30));
                                s.blocks.add(new Store.Block("Work", "work", 12 * 60));
                                s.blocks.add(new Store.Block("Dinner", "strict", 60));
                                s.blocks.add(new Store.Block("Free time", "free", 60));
                                s.blocks.add(new Store.Block("Wind down", "strict", 60));
                                s.blocks.add(new Store.Block("Sleep", "strict", 8 * 60));
                                s.scheduleChanged();
                                render();
                            }
                        }).setNegativeButton("Cancel", null).show();
            }
        });
        col.addView(reset, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        setContentView(root);
        render();
        Ui.stagger(list);
    }

    private void render() {
        Store s = Store.get(this);
        long now = System.currentTimeMillis();
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, s.defaultWake / 60);
        c.set(Calendar.MINUTE, s.defaultWake % 60);
        wakeBtn.setText("Usual wake " + Ui.clock(c.getTimeInMillis()));
        woke.setText(s.dayStartedByTap(now) ? "Undo wake-up" : "I just woke up");
        sub.setText(s.dayStartedByTap(now)
                ? "Your day started when you woke at " + Ui.clock(s.wakeAt) + ". Each block follows the one before it."
                : "Using your usual wake time. Tap “I just woke up” and the whole day shifts to start now.");
        list.removeAllViews();
        List<Store.Slot> slots = s.slots(now);
        Store.Slot cur = s.current(now);
        for (final Store.Slot sl : slots) {
            boolean isNow = cur.index == sl.index;
            boolean god = "god".equals(sl.preset);
            LinearLayout row = Ui.row(this);
            row.setBackground(new Ui.StoneDrawable(this, Ui.STONE, isNow ? (god ? 0x66F2D38A : 0x66AACFF6) : 0x14FFFFFF, 18));
            row.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
            LinearLayout left = Ui.column(this);
            TextView time = Ui.mono(this, Ui.clockShort(sl.start) + "–" + Ui.clock(sl.end), 11, isNow ? (god ? Ui.GOLD : Ui.ICE) : Ui.MUTED);
            left.addView(time);
            left.addView(Ui.text(this, sl.title, 17, Ui.INK, Ui.SORA_MED), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
            left.addView(Ui.text(this, s.presetName(sl.preset) + " · " + Ui.lengthWords((int) sl.lengthMin()), 13, Ui.MUTED, Ui.SORA), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 4)));
            row.addView(left, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            if (isNow) row.addView(Ui.mono(this, "Now", 11, god ? Ui.GOLD : Ui.ICE));
            row.setClickable(true);
            Ui.press(row);
            row.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { edit(sl.index); } });
            list.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, list.getChildCount() == 0 ? 0 : Ui.dp(this, 8)));
        }
        TextView after = Ui.text(this, "After the last block: open time (Normal) until your next wake time.", 12, Ui.QUIET, Ui.SORA);
        list.addView(after, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 12)));
    }

    private void pickWake() {
        final Store s = Store.get(this);
        new TimePickerDialog(this, android.R.style.Theme_DeviceDefault_Dialog_Alert, new TimePickerDialog.OnTimeSetListener() {
            @Override public void onTimeSet(TimePicker v, int h, int m) {
                s.defaultWake = h * 60 + m;
                s.scheduleChanged();
                render();
            }
        }, s.defaultWake / 60, s.defaultWake % 60, false).show();
    }

    private void edit(final int index) {
        final Store s = Store.get(this);
        final boolean isNew = index < 0 || index >= s.blocks.size();
        final Store.Block blk = isNew ? new Store.Block("", "normal", 60) : s.blocks.get(index);
        LinearLayout v = Ui.column(this);
        v.setPadding(Ui.dp(this, 24), Ui.dp(this, 8), Ui.dp(this, 24), 0);
        final EditText name = new EditText(this);
        name.setHint("Name, like Work or Gym");
        name.setText(blk.title);
        name.setSingleLine(true);
        name.setTextColor(Ui.INK);
        name.setTypeface(Ui.SORA);
        v.addView(name, Ui.lp(Ui.MATCH, Ui.WRAP));
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
        v.addView(Ui.label(this, "How long"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 14)));
        LinearLayout lenRow = Ui.row(this);
        lenRow.setGravity(Gravity.CENTER);
        final NumberPicker hp = new NumberPicker(this);
        hp.setMinValue(0); hp.setMaxValue(16); hp.setValue(blk.len / 60);
        final NumberPicker mp = new NumberPicker(this);
        final String[] mins = new String[12];
        for (int i = 0; i < 12; i++) mins[i] = String.format(Locale.US, "%02d", i * 5);
        mp.setMinValue(0); mp.setMaxValue(11); mp.setDisplayedValues(mins); mp.setValue(Math.min(11, (blk.len % 60) / 5));
        lenRow.addView(hp);
        lenRow.addView(Ui.text(this, "  hours   ", 14, Ui.MUTED, Ui.SORA));
        lenRow.addView(mp);
        lenRow.addView(Ui.text(this, "  min", 14, Ui.MUTED, Ui.SORA));
        v.addView(lenRow, Ui.lp(Ui.MATCH, Ui.WRAP));

        AlertDialog.Builder bld = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(isNew ? "New block" : "Edit block")
                .setView(v)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        String t = name.getText().toString().trim();
                        blk.title = t.isEmpty() ? s.presetName(blk.preset) : t;
                        int sel = rg.getCheckedRadioButtonId() - 1000;
                        if (sel >= 0 && sel < Store.PRESET_IDS.length) blk.preset = Store.PRESET_IDS[sel];
                        if (t.isEmpty()) blk.title = s.presetName(blk.preset);
                        blk.len = Math.max(5, hp.getValue() * 60 + mp.getValue() * 5);
                        if (isNew) s.blocks.add(blk);
                        s.scheduleChanged();
                        render();
                    }
                })
                .setNegativeButton("Cancel", null);
        if (!isNew) {
            bld.setNeutralButton("More", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) { more(index); }
            });
        }
        bld.show();
    }

    private void more(final int index) {
        final Store s = Store.get(this);
        String[] items = {"Move earlier", "Move later", "Delete block"};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setItems(items, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        if (index < 0 || index >= s.blocks.size()) return;
                        if (w == 0 && index > 0) s.blocks.add(index - 1, s.blocks.remove(index));
                        else if (w == 1 && index < s.blocks.size() - 1) s.blocks.add(index + 1, s.blocks.remove(index));
                        else if (w == 2) s.blocks.remove(index);
                        s.scheduleChanged();
                        render();
                    }
                }).show();
    }
}
