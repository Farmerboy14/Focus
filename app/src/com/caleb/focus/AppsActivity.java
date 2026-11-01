package com.caleb.focus;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Every app, with what the current block says about it. */
public class AppsActivity extends Activity {
    private final List<Apps.AppInfo> all = new ArrayList<>();
    private final List<Apps.AppInfo> shown = new ArrayList<>();
    private Adapter adapter;
    private TextView sub;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Ui.BG);
        SkyView sky = new SkyView(this, false);
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
        col.addView(Ui.text(this, "All apps", 30, Ui.INK, Ui.SORA_LIGHT), Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 16)));
        sub = Ui.text(this, "", 13, Ui.MUTED, Ui.SORA);
        col.addView(sub, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));

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
        col.addView(q, Ui.lp(Ui.MATCH, Ui.dp(this, 46), Ui.dp(this, 14)));

        ListView list = new ListView(this);
        list.setDivider(null);
        list.setSelector(android.R.color.transparent);
        list.setClipToPadding(false);
        list.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 40));
        adapter = new Adapter(this);
        list.setAdapter(adapter);
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> p, View v, int pos, long id) {
                HomeActivity.openApp(AppsActivity.this, shown.get(pos).pkg);
            }
        });
        list.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override public boolean onItemLongClick(AdapterView<?> p, View v, int pos, long id) { options(shown.get(pos)); return true; }
        });
        col.addView(list, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        all.clear();
        all.addAll(Apps.launchable(this, true));
        Store.Preset p = Store.get(this).currentPreset(System.currentTimeMillis());
        sub.setText("Now: " + p.name + ". Hold an app for more options.");
        filter("");
    }

    private void filter(String q) {
        shown.clear();
        String l = q.toLowerCase(Locale.US).trim();
        for (Apps.AppInfo a : all) if (l.isEmpty() || a.label.toLowerCase(Locale.US).contains(l)) shown.add(a);
        adapter.notifyDataSetChanged();
    }

    private void options(final Apps.AppInfo a) {
        final Store s = Store.get(this);
        final boolean ent = s.isEntertainment(this, a.pkg);
        final boolean pinned = s.pins.contains(a.pkg);
        String[] items = {pinned ? "Remove from home screen" : "Show on home screen when allowed",
                ent ? "Not entertainment" : "Mark as entertainment (Free time only)", "App info"};
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(a.label)
                .setItems(items, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        if (which == 0) {
                            if (pinned) s.pins.remove(a.pkg); else s.pins.add(a.pkg);
                            s.save();
                        } else if (which == 1) {
                            if (ent) { s.entertainment.remove(a.pkg); s.entertainment.add("!" + a.pkg); }
                            else { s.entertainment.add(a.pkg); s.entertainment.remove("!" + a.pkg); }
                            s.save();
                            adapter.notifyDataSetChanged();
                        } else {
                            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.pkg)));
                        }
                    }
                }).show();
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
                LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(Ui.dp(c, 36), Ui.dp(c, 36));
                ip.rightMargin = Ui.dp(c, 14);
                row.addView(ic, ip);
                TextView name = Ui.text(c, "", 15, Ui.INK, Ui.SORA);
                name.setSingleLine(true);
                name.setEllipsize(android.text.TextUtils.TruncateAt.END);
                row.addView(name, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
                TextView st = Ui.mono(c, "", 10, Ui.MUTED);
                row.addView(st);
                row.setTag(new Object[]{ic, name, st});
            } else row = (LinearLayout) v;
            Object[] tg = (Object[]) row.getTag();
            Apps.AppInfo a = shown.get(i);
            ((ImageView) tg[0]).setImageDrawable(Apps.icon(c, a.pkg));
            ((TextView) tg[1]).setText(a.label);
            Store.Decision d = Store.get(c).decide(c, a.pkg, System.currentTimeMillis());
            String st;
            int col;
            if (d.mode == Store.ALLOW) { st = ""; col = Ui.MUTED; }
            else if (d.entertainment) { st = "FREE TIME"; col = Ui.QUIET; }
            else if (d.mode == Store.REASON) { st = "NEEDS A REASON"; col = Ui.GOLD_DEEP; }
            else { st = "NOT NOW"; col = Ui.QUIET; }
            ((TextView) tg[2]).setText(st);
            ((TextView) tg[2]).setTextColor(col);
            ((ImageView) tg[0]).setAlpha(d.mode == Store.ALLOW ? 1f : 0.4f);
            ((TextView) tg[1]).setTextColor(d.mode == Store.ALLOW ? Ui.INK : Ui.MUTED);
            return row;
        }
    }
}
