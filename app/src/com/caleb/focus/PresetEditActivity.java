package com.caleb.focus;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.Switch;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Pick what one preset allows. Tap an app to cycle Allowed → Needs a reason → Blocked. */
public class PresetEditActivity extends Activity {
    private String id;
    private boolean entMode;
    private Store.Preset preset;
    private final List<Apps.AppInfo> all = new ArrayList<>(), shown = new ArrayList<>();
    private Adapter adapter;
    private TextView defBtn;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        id = getIntent().getStringExtra("preset");
        entMode = "ent".equals(id);
        final Store s = Store.get(this);
        preset = entMode ? null : s.presets.get(id);
        if (!entMode && preset == null) { finish(); return; }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, "god".equals(id));
        sky.setVeil(0.55f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 8), 0);

        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        col.addView(top);

        ListView lv = new ListView(this);
        lv.setDivider(null);
        lv.setSelector(android.R.color.transparent);
        lv.setClipToPadding(false);
        lv.setPadding(0, 0, 0, Ui.dp(this, 40));
        LinearLayout head = Ui.column(this);
        head.addView(Ui.text(this, entMode ? "Entertainment" : preset.name, 30, "god".equals(id) ? Ui.GOLD : Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        TextView sub = Ui.text(this, entMode
                ? "These only open during Free time, in every other block, with no reason unlock. Games are included automatically."
                : "Tap an app to switch it between Allowed, Needs a reason, and Blocked. Calls, texts, camera, calculator and clock always work.",
                13, Ui.MUTED, Ui.SORA);
        sub.setLineSpacing(0, 1.3f);
        head.addView(sub, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 6)));

        if (!entMode) {
            LinearLayout r1 = Ui.row(this);
            r1.addView(Ui.text(this, "Turn on Do Not Disturb", 15, Ui.INK, Ui.SORA), new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            Switch sw = new Switch(this);
            sw.setChecked(preset.dnd);
            sw.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                @Override public void onCheckedChanged(CompoundButton bt, boolean on) { preset.dnd = on; s.save(); }
            });
            r1.addView(sw);
            head.addView(r1, Ui.lp(Ui.MATCH, Ui.dp(this, 52), Ui.dp(this, 12)));
            LinearLayout r2 = Ui.row(this);
            r2.addView(Ui.text(this, "Apps you haven't set", 15, Ui.INK, Ui.SORA), new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            defBtn = Ui.chip(this, "", true);
            defBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    preset.defaultMode = preset.defaultMode == Store.ALLOW ? Store.BLOCK : Store.ALLOW;
                    s.save();
                    paintDefault();
                    adapter.notifyDataSetChanged();
                }
            });
            r2.addView(defBtn);
            head.addView(r2, Ui.lp(Ui.MATCH, Ui.dp(this, 52)));
            paintDefault();
        }

        EditText q = new EditText(this);
        q.setHint("Search apps");
        q.setHintTextColor(Ui.QUIET);
        q.setTextColor(Ui.INK);
        q.setTypeface(Ui.SORA);
        q.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        q.setSingleLine(true);
        q.setPadding(Ui.dp(this, 16), 0, Ui.dp(this, 16), 0);
        q.setBackground(new Ui.StoneDrawable(this, Ui.STONE, Ui.BORDER_ICE, 999));
        q.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence c, int a, int b2, int d) { }
            @Override public void onTextChanged(CharSequence c, int a, int b2, int d) { filter(c.toString()); }
            @Override public void afterTextChanged(Editable e) { }
        });
        head.addView(q, Ui.lp(Ui.MATCH, Ui.dp(this, 46), Ui.dp(this, 14)));
        View pad = new View(this);
        head.addView(pad, Ui.lp(Ui.MATCH, Ui.dp(this, 8)));
        col.addView(head, Ui.lp(Ui.MATCH, Ui.WRAP));

        adapter = new Adapter(this);
        lv.setAdapter(adapter);
        lv.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> p, View v, int pos, long rid) {
                int i = pos;
                if (i < 0 || i >= shown.size()) return;
                toggle(shown.get(i).pkg);
            }
        });
        col.addView(lv, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        setContentView(root);
        all.addAll(Apps.launchable(this, true));
        filter("");
    }

    private void paintDefault() {
        defBtn.setText(preset.defaultMode == Store.ALLOW ? "Allowed" : "Blocked");
        defBtn.setTextColor(preset.defaultMode == Store.ALLOW ? Ui.INK : Ui.QUIET);
    }

    private void filter(String q) {
        shown.clear();
        String l = q.toLowerCase(Locale.US).trim();
        for (Apps.AppInfo a : all) if (l.isEmpty() || a.label.toLowerCase(Locale.US).contains(l)) shown.add(a);
        adapter.notifyDataSetChanged();
    }

    private void toggle(String pkg) {
        Store s = Store.get(this);
        if (entMode) {
            if (s.isEntertainment(this, pkg)) { s.entertainment.remove(pkg); s.entertainment.add("!" + pkg); }
            else { s.entertainment.add(pkg); s.entertainment.remove("!" + pkg); }
        } else {
            if (Apps.isEssential(this, pkg) || Apps.isSystemSafe(this, pkg) || s.isEntertainment(this, pkg)) return;
            int cur = s.modeIn(this, preset, pkg);
            int next = cur == Store.ALLOW ? Store.REASON : cur == Store.REASON ? Store.BLOCK : Store.ALLOW;
            if (next == preset.defaultMode) preset.modes.remove(pkg); else preset.modes.put(pkg, next);
        }
        s.save();
        Ui.vibrate(this);
        adapter.notifyDataSetChanged();
    }

    private class Adapter extends BaseAdapter {
        private final Context c;
        Adapter(Context c) { this.c = c; }
        @Override public int getCount() { return shown.size(); }
        @Override public Object getItem(int i) { return shown.get(i); }
        @Override public long getItemId(int i) { return i; }
        @Override
        public View getView(int i, View v, ViewGroup parent) {
            LinearLayout row;
            if (v == null) {
                row = Ui.row(c);
                row.setMinimumHeight(Ui.dp(c, 58));
                ImageView ic = new ImageView(c);
                LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(Ui.dp(c, 34), Ui.dp(c, 34));
                ip.rightMargin = Ui.dp(c, 14);
                row.addView(ic, ip);
                TextView name = Ui.text(c, "", 15, Ui.INK, Ui.SORA);
                name.setSingleLine(true);
                name.setEllipsize(android.text.TextUtils.TruncateAt.END);
                row.addView(name, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
                TextView st = Ui.mono(c, "", 10, Ui.MUTED);
                st.setPadding(Ui.dp(c, 12), Ui.dp(c, 8), Ui.dp(c, 12), Ui.dp(c, 8));
                row.addView(st);
                row.setTag(new Object[]{ic, name, st});
            } else row = (LinearLayout) v;
            Object[] tg = (Object[]) row.getTag();
            Apps.AppInfo a = shown.get(i);
            ((ImageView) tg[0]).setImageDrawable(Apps.icon(c, a.pkg));
            ((TextView) tg[1]).setText(a.label);
            TextView st = (TextView) tg[2];
            Store s = Store.get(c);
            String txt;
            int col, edge;
            if (entMode) {
                boolean e = s.isEntertainment(c, a.pkg);
                txt = e ? "ENTERTAINMENT" : "—";
                col = e ? Ui.GOLD : Ui.QUIET;
                edge = e ? 0x4DF2D38A : 0x0FFFFFFF;
            } else if (Apps.isEssential(c, a.pkg) || Apps.isSystemSafe(c, a.pkg)) {
                txt = "ALWAYS"; col = Ui.MUTED; edge = 0x0FFFFFFF;
            } else if (s.isEntertainment(c, a.pkg)) {
                txt = "free".equals(id) ? "ALLOWED" : "FREE TIME ONLY"; col = Ui.QUIET; edge = 0x0FFFFFFF;
            } else {
                int m = s.modeIn(c, preset, a.pkg);
                if (m == Store.ALLOW) { txt = "ALLOWED"; col = Ui.INK; edge = 0x29AACFF6; }
                else if (m == Store.REASON) { txt = "NEEDS A REASON"; col = Ui.GOLD; edge = 0x4DF2D38A; }
                else { txt = "BLOCKED"; col = Ui.QUIET; edge = 0x14FFFFFF; }
            }
            st.setText(txt);
            st.setTextColor(col);
            st.setBackground(new Ui.StoneDrawable(c, Ui.STONE, edge, 999));
            return row;
        }
    }
}
