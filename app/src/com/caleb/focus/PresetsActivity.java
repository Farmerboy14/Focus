package com.caleb.focus;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.ScrollView;
import android.widget.TextView;

/** The presets a block can switch the phone into, plus entertainment apps and the YouTube allowance. */
public class PresetsActivity extends Activity {
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
        col.addView(Ui.text(this, "Presets", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        TextView sub = Ui.text(this, "Each block switches the phone to one of these. Calls, texts, camera, calculator and clock always work.", 13, Ui.MUTED, Ui.SORA);
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

    private void render() {
        final Store s = Store.get(this);
        list.removeAllViews();
        for (final String id : Store.PRESET_IDS) {
            Store.Preset p = s.presets.get(id);
            int reason = 0, blocked = 0, allowed = 0;
            for (Integer m : p.modes.values()) { if (m == Store.REASON) reason++; else if (m == Store.BLOCK) blocked++; else allowed++; }
            String sum;
            if (p.defaultMode == Store.BLOCK) sum = "Only the basics" + (allowed > 0 ? " + " + allowed + (allowed == 1 ? " app" : " apps") : "");
            else sum = "Everything but entertainment" + (reason > 0 ? " · " + reason + " need a reason" : "") + (blocked > 0 ? " · " + blocked + " blocked" : "");
            if ("free".equals(id)) sum = "Everything, including entertainment";
            if (p.dnd) sum += " · Do Not Disturb";
            addRow(p.name, sum, "god".equals(id), new View.OnClickListener() {
                @Override public void onClick(View v) {
                    startActivity(new Intent(PresetsActivity.this, PresetEditActivity.class).putExtra("preset", id));
                }
            });
        }
        list.addView(Ui.label(this, "Limits"), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 22)));
        int ent = 0;
        for (String e : s.entertainment) if (!e.startsWith("!")) ent++;
        addRow("Entertainment apps", "Only open in Free time. Social media can never be unlocked with a reason.", false, new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(PresetsActivity.this, PresetEditActivity.class).putExtra("preset", "ent"));
            }
        });
        addRow("YouTube in Chrome", s.ytLimitMin + " minutes a day outside Free time", false, new View.OnClickListener() {
            @Override public void onClick(View v) { pickYouTube(); }
        });
    }

    private void addRow(String title, String sum, boolean gold, View.OnClickListener click) {
        LinearLayout row = Ui.column(this);
        row.setBackground(new Ui.StoneDrawable(this, Ui.STONE, gold ? 0x33F2D38A : 0x14FFFFFF, 18));
        row.setPadding(Ui.dp(this, 16), Ui.dp(this, 14), Ui.dp(this, 16), Ui.dp(this, 14));
        row.addView(Ui.text(this, title, 17, gold ? Ui.GOLD : Ui.INK, Ui.SORA_MED));
        TextView st = Ui.text(this, sum, 13, Ui.MUTED, Ui.SORA);
        st.setLineSpacing(0, 1.25f);
        row.addView(st, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));
        row.setClickable(true);
        Ui.press(row);
        row.setOnClickListener(click);
        list.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
    }

    private void pickYouTube() {
        final Store s = Store.get(this);
        final NumberPicker np = new NumberPicker(this);
        final String[] vals = new String[25];
        for (int i = 0; i < vals.length; i++) vals[i] = (i * 5) + " min";
        np.setMinValue(0);
        np.setMaxValue(vals.length - 1);
        np.setDisplayedValues(vals);
        np.setValue(Math.min(vals.length - 1, s.ytLimitMin / 5));
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("YouTube in Chrome each day")
                .setView(np)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { s.ytLimitMin = np.getValue() * 5; s.save(); render(); }
                })
                .setNegativeButton("Cancel", null).show();
    }
}
