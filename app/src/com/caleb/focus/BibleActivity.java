package com.caleb.focus;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.SuperscriptSpan;
import android.text.style.TypefaceSpan;
import android.util.TypedValue;
import android.view.ActionMode;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The King James Bible: read by chapter, and search every verse for a word (a concordance). */
public class BibleActivity extends Activity {
    private TextView chapterPill, title, body, status;
    private ScrollView scroll;
    private LinearLayout searchPanel;
    private EditText query;
    private TextView count;
    private final List<Bible.Ref> results = new ArrayList<>();
    private ResultAdapter adapter;
    private int book = 40, chapter = 1; // Mark 1
    private SharedPreferences sp;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui.init(this);
        Ui.deeperTransitions(this);
        sp = Store.get(this).prefs();
        book = sp.getInt("bible_book", 40);
        chapter = sp.getInt("bible_ch", 1);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF080B14);
        SkyView sky = new SkyView(this, true);
        sky.setVeil(0.72f);
        root.addView(sky, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));

        LinearLayout col = Ui.column(this);
        root.addView(col, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        Ui.edgeToEdge(this, col, Ui.dp(this, 20), Ui.dp(this, 8), 0);

        LinearLayout top = Ui.row(this);
        TextView back = Ui.pill(this, "‹");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        back.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finish(); } });
        top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 40), Ui.dp(this, 40)));
        top.addView(Ui.space(this));
        chapterPill = Ui.pill(this, "");
        chapterPill.setTextColor(Ui.INK);
        chapterPill.setTypeface(Ui.SORA_SEMI);
        chapterPill.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { pickBook(); } });
        top.addView(chapterPill);
        TextView find = Ui.pill(this, "Search");
        find.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { openSearch(""); } });
        LinearLayout.LayoutParams fp = new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP);
        fp.leftMargin = Ui.dp(this, 8);
        top.addView(find, fp);
        col.addView(top, Ui.lp(Ui.MATCH, Ui.WRAP));

        scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setClipToPadding(false);
        LinearLayout inner = Ui.column(this);
        inner.setPadding(0, Ui.dp(this, 20), 0, Ui.dp(this, 40));
        TextView kjv = Ui.mono(this, "King James Version", 11, Ui.GOLD_DEEP);
        kjv.setLetterSpacing(0.14f);
        inner.addView(kjv);
        title = Ui.text(this, "", 34, Ui.INK, Ui.NEWS_MED);
        inner.addView(title, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 6)));
        body = Ui.text(this, "", 19, 0xFFE9E6DD, Ui.NEWS);
        body.setLineSpacing(0, 1.45f);
        body.setTextIsSelectable(true);
        body.setHighlightColor(0x40F2D38A);
        body.setCustomSelectionActionModeCallback(new ActionMode.Callback() {
            @Override public boolean onCreateActionMode(ActionMode m, Menu menu) { menu.add(0, 7, 0, "Find in Bible"); return true; }
            @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) { return false; }
            @Override public boolean onActionItemClicked(ActionMode m, MenuItem item) {
                if (item.getItemId() != 7) return false;
                int s = Math.max(0, body.getSelectionStart()), e = Math.max(0, body.getSelectionEnd());
                String w = body.getText().subSequence(Math.min(s, e), Math.max(s, e)).toString().replaceAll("[^A-Za-z' ]", " ").trim();
                m.finish();
                openSearch(w);
                return true;
            }
            @Override public void onDestroyActionMode(ActionMode m) { }
        });
        inner.addView(body, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 14)));
        TextView hint = Ui.mono(this, "Hold any word to find it across the Bible", 10, Ui.QUIET);
        hint.setGravity(Gravity.CENTER);
        inner.addView(hint, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 22)));
        LinearLayout nav = Ui.row(this);
        TextView prev = Ui.chip(this, "‹ Previous", true);
        prev.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { step(-1); } });
        TextView next = Ui.chip(this, "Next ›", true);
        next.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { step(1); } });
        nav.addView(prev);
        nav.addView(Ui.space(this));
        nav.addView(next);
        inner.addView(nav, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 16)));
        scroll.addView(inner);
        col.addView(scroll, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));

        status = Ui.mono(this, "Opening the Bible…", 11, Ui.MUTED);
        root.addView(status, new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.CENTER));

        buildSearchPanel(root);
        setContentView(root);
        Bible.load(this, new Runnable() {
            @Override public void run() {
                status.setVisibility(View.GONE);
                show(book, chapter, -1);
                Ui.stagger(title, body);
            }
        });
    }

    private void step(int d) {
        if (!Bible.loaded()) return;
        int b = book, c = chapter + d;
        if (c < 1) { b--; if (b < 0) return; c = Bible.text[b].length; }
        else if (c > Bible.text[b].length) { b++; if (b >= Bible.books.length) return; c = 1; }
        show(b, c, -1);
        Ui.stagger(title, body);
    }

    private void show(int b, int c, int highlightVerse) {
        if (!Bible.loaded()) return;
        book = Math.max(0, Math.min(Bible.books.length - 1, b));
        chapter = Math.max(1, Math.min(Bible.text[book].length, c));
        sp.edit().putInt("bible_book", book).putInt("bible_ch", chapter).apply();
        String name = Bible.books[book] + " " + chapter;
        chapterPill.setText(name + "  ▾");
        title.setText(name);
        String[] vs = Bible.text[book][chapter - 1];
        SpannableStringBuilder sb = new SpannableStringBuilder();
        int target = -1;
        for (int i = 0; i < vs.length; i++) {
            int st = sb.length();
            if (i + 1 == highlightVerse) target = st;
            String num = String.valueOf(i + 1);
            sb.append(num);
            sb.setSpan(new ForegroundColorSpan(Ui.GOLD_DEEP), st, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new RelativeSizeSpan(0.55f), st, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new SuperscriptSpan(), st, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.setSpan(new TypefaceSpan(Ui.MONO), st, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            sb.append(" ");
            int ts = sb.length();
            sb.append(vs[i]);
            if (i + 1 == highlightVerse) {
                sb.setSpan(new BackgroundColorSpan(0x24F2D38A), ts, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new ForegroundColorSpan(Ui.GOLD_LIGHT), ts, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            if (i < vs.length - 1) {
                sb.append("\n");
                int gs = sb.length();
                sb.append("\n");
                sb.setSpan(new RelativeSizeSpan(0.35f), gs, sb.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        body.setText(sb);
        final int off = target;
        scroll.post(new Runnable() {
            @Override public void run() {
                if (off < 0 || body.getLayout() == null) { scroll.scrollTo(0, 0); return; }
                int line = body.getLayout().getLineForOffset(off);
                int y = body.getTop() + body.getLayout().getLineTop(line) - Ui.dp(BibleActivity.this, 80);
                scroll.smoothScrollTo(0, Math.max(0, y));
            }
        });
    }

    private void pickBook() {
        if (!Bible.loaded()) return;
        AlertDialog.Builder bld = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert);
        bld.setTitle("Book");
        bld.setItems(Bible.books, new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, final int which) {
                int n = Bible.text[which].length;
                if (n == 1) { show(which, 1, -1); return; }
                String[] chs = new String[n];
                for (int i = 0; i < n; i++) chs[i] = Bible.books[which] + " " + (i + 1);
                new AlertDialog.Builder(BibleActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                        .setTitle(Bible.books[which])
                        .setItems(chs, new DialogInterface.OnClickListener() {
                            @Override public void onClick(DialogInterface d2, int c) { show(which, c + 1, -1); Ui.stagger(title, body); }
                        }).show();
            }
        });
        bld.show();
    }

    // ---------- concordance search ----------

    private void buildSearchPanel(FrameLayout root) {
        searchPanel = Ui.column(this);
        searchPanel.setBackground(new Ui.StoneDrawable(this, 0xF2060910, 0x2EF2D38A, 26));
        searchPanel.setPadding(Ui.dp(this, 20), Ui.dp(this, 14), Ui.dp(this, 20), 0);
        searchPanel.setClickable(true);
        View grab = new View(this);
        grab.setBackgroundColor(0x38FFFFFF);
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(Ui.dp(this, 36), Ui.dp(this, 4));
        gp.gravity = Gravity.CENTER_HORIZONTAL;
        searchPanel.addView(grab, gp);
        LinearLayout row = Ui.row(this);
        query = new EditText(this);
        query.setHint("Find a word, like prayed");
        query.setHintTextColor(Ui.QUIET);
        query.setTextColor(Ui.INK);
        query.setTypeface(Ui.NEWS);
        query.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        query.setSingleLine(true);
        query.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        query.setBackground(null);
        query.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(TextView v, int id, KeyEvent e) { runSearch(); return true; }
        });
        row.addView(query, new LinearLayout.LayoutParams(0, Ui.dp(this, 52), 1f));
        TextView close = Ui.plain(this, "Close", Ui.MUTED);
        close.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { closeSearch(); } });
        row.addView(close);
        searchPanel.addView(row, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(this, 8)));
        count = Ui.mono(this, "", 11, Ui.GOLD_DEEP);
        searchPanel.addView(count, Ui.lp(Ui.WRAP, Ui.WRAP, Ui.dp(this, 4)));
        ListView list = new ListView(this);
        list.setDivider(null);
        list.setSelector(android.R.color.transparent);
        adapter = new ResultAdapter(this);
        list.setAdapter(adapter);
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> p, View v, int pos, long id) {
                Bible.Ref r = results.get(pos);
                closeSearch();
                show(r.book, r.chapter, r.verse);
            }
        });
        searchPanel.addView(list, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH);
        lp.topMargin = Ui.dp(this, 90);
        searchPanel.setVisibility(View.GONE);
        root.addView(searchPanel, lp);
        searchPanel.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(View v, android.view.WindowInsets in) {
                int bottom = Math.max(in.getInsets(android.view.WindowInsets.Type.ime()).bottom, in.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom);
                v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), bottom);
                return in;
            }
        });
    }

    private void openSearch(String w) {
        searchPanel.setVisibility(View.VISIBLE);
        searchPanel.setTranslationY(getResources().getDisplayMetrics().heightPixels);
        searchPanel.animate().translationY(0).setDuration(600).setInterpolator(new android.view.animation.OvershootInterpolator(0.7f)).start();
        query.setText(w);
        query.setSelection(w.length());
        if (w.length() > 1) runSearch();
        else {
            query.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(query, 0);
        }
    }

    private void closeSearch() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(query.getWindowToken(), 0);
        searchPanel.animate().translationY(getResources().getDisplayMetrics().heightPixels).setDuration(260)
                .withEndAction(new Runnable() { @Override public void run() { searchPanel.setVisibility(View.GONE); } }).start();
    }

    private void runSearch() {
        String q = query.getText().toString().trim();
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(query.getWindowToken(), 0);
        results.clear();
        if (!Bible.loaded() || q.length() < 2) { count.setText(""); adapter.notifyDataSetChanged(); return; }
        List<Bible.Ref> all = Bible.search(q, 5000);
        int total = all.size();
        results.addAll(all.size() > 600 ? all.subList(0, 600) : all);
        count.setText(total == 0 ? "NO VERSES FOUND" : (total + (total == 1 ? " VERSE" : " VERSES") + (total > 600 ? " · SHOWING 600" : "")));
        adapter.q = q.toLowerCase(Locale.US);
        adapter.notifyDataSetChanged();
    }

    @Override
    public void onBackPressed() {
        if (searchPanel.getVisibility() == View.VISIBLE) { closeSearch(); return; }
        super.onBackPressed();
    }

    private class ResultAdapter extends BaseAdapter {
        private final Context c;
        String q = "";
        ResultAdapter(Context c) { this.c = c; }
        @Override public int getCount() { return results.size(); }
        @Override public Object getItem(int i) { return results.get(i); }
        @Override public long getItemId(int i) { return i; }
        @Override
        public View getView(int i, View v, ViewGroup parent) {
            LinearLayout row;
            TextView ref, txt;
            if (v == null) {
                row = Ui.column(c);
                row.setPadding(0, Ui.dp(c, 12), 0, Ui.dp(c, 12));
                ref = Ui.mono(c, "", 11, Ui.GOLD_DEEP);
                txt = Ui.text(c, "", 16, 0xFFD9DBE0, Ui.NEWS);
                txt.setLineSpacing(0, 1.25f);
                row.addView(ref);
                row.addView(txt, Ui.lp(Ui.MATCH, Ui.WRAP, Ui.dp(c, 4)));
                row.setTag(new TextView[]{ref, txt});
            } else {
                row = (LinearLayout) v;
            }
            TextView[] tv = (TextView[]) row.getTag();
            Bible.Ref r = results.get(i);
            tv[0].setText(r.label().toUpperCase(Locale.US));
            SpannableStringBuilder sb = new SpannableStringBuilder(r.text);
            String l = r.text.toLowerCase(Locale.US);
            int at = q.isEmpty() ? -1 : l.indexOf(q);
            if (at >= 0) {
                sb.setSpan(new ForegroundColorSpan(Ui.GOLD_LIGHT), at, at + q.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                sb.setSpan(new BackgroundColorSpan(0x1FF2D38A), at, at + q.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            tv[1].setText(sb);
            return row;
        }
    }
}
