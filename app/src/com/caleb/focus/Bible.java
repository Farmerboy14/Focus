package com.caleb.focus;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** The King James Bible, loaded once from the app, with search and a verse for each day. */
public final class Bible {
    private Bible() { }

    public static String[] books;
    /** chapters[book][chapter-1] = verses */
    public static String[][][] text;
    private static boolean loading;
    private static final List<Runnable> waiting = new ArrayList<>();

    public interface Ready { void ready(); }

    public static synchronized boolean loaded() { return text != null; }

    public static void load(final Context c, final Runnable done) {
        synchronized (Bible.class) {
            if (text != null) { done.run(); return; }
            waiting.add(done);
            if (loading) return;
            loading = true;
        }
        final Context app = c.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                String[] bk = null;
                String[][][] tx = null;
                try {
                    BufferedReader r = new BufferedReader(new InputStreamReader(app.getAssets().open("kjv.txt"), "UTF-8"), 1 << 16);
                    bk = r.readLine().split("\\|");
                    List<List<List<String>>> all = new ArrayList<>();
                    for (int i = 0; i < bk.length; i++) all.add(new ArrayList<List<String>>());
                    String line;
                    while ((line = r.readLine()) != null) {
                        int a = line.indexOf('\t'), b2 = line.indexOf('\t', a + 1), c2 = line.indexOf('\t', b2 + 1);
                        if (a < 0 || b2 < 0 || c2 < 0) continue;
                        int book = Integer.parseInt(line.substring(0, a));
                        int ch = Integer.parseInt(line.substring(a + 1, b2));
                        List<List<String>> chs = all.get(book);
                        while (chs.size() < ch) chs.add(new ArrayList<String>());
                        chs.get(ch - 1).add(line.substring(c2 + 1));
                    }
                    r.close();
                    tx = new String[bk.length][][];
                    for (int i = 0; i < bk.length; i++) {
                        List<List<String>> chs = all.get(i);
                        tx[i] = new String[chs.size()][];
                        for (int j = 0; j < chs.size(); j++) tx[i][j] = chs.get(j).toArray(new String[0]);
                    }
                } catch (Exception e) {
                    bk = new String[]{"Psalms"};
                    tx = new String[][][]{{{"Be still, and know that I am God."}}};
                }
                final List<Runnable> run;
                synchronized (Bible.class) {
                    books = bk;
                    text = tx;
                    loading = false;
                    run = new ArrayList<>(waiting);
                    waiting.clear();
                }
                new Handler(Looper.getMainLooper()).post(new Runnable() {
                    @Override public void run() { for (Runnable x : run) x.run(); }
                });
            }
        }).start();
    }

    public static class Ref {
        public int book, chapter, verse; // chapter and verse are 1-based
        public String text;
        public Ref(int b, int c, int v, String t) { book = b; chapter = c; verse = v; text = t; }
        public String label() { return (books != null && book < books.length ? books[book] : "Psalms") + " " + chapter + ":" + verse; }
    }

    // Chapters skipped for the daily verse: genealogies, census lists, building measurements.
    private static boolean skipChapter(String book, int ch) {
        switch (book) {
            case "Genesis": return ch == 5 || ch == 10 || ch == 11 || ch == 25 || ch == 36 || ch == 46;
            case "Exodus": return ch == 6 || (ch >= 25 && ch <= 31) || (ch >= 35 && ch <= 40);
            case "Leviticus": return ch != 19 && ch != 26;
            case "Numbers": return (ch >= 1 && ch <= 4) || ch == 7 || ch == 26 || ch == 28 || ch == 29 || ch == 33 || ch == 34;
            case "Joshua": return ch >= 12 && ch <= 21;
            case "1 Chronicles": return ch <= 9 || (ch >= 23 && ch <= 27);
            case "Ezra": return ch == 2 || ch == 8 || ch == 10;
            case "Nehemiah": return ch == 3 || ch == 7 || (ch >= 10 && ch <= 12);
            case "Ezekiel": return ch >= 40;
            case "Matthew": return ch == 1;
            case "Luke": return ch == 3;
            default: return false;
        }
    }

    private static final String[] WORDS = {"god", "lord", "jesus", "christ", "spirit", "faith", "love", "mercy", "grace", "pray",
            "trust", "hope", "peace", "righteous", "salvation", "saviour", "holy", "praise", "strength", "wisdom", "forgive",
            "eternal", "everlasting", "truth", "blessed", "fear not"};
    private static final String[] AVOID = {"begat", "cubit", "shekel", "slew", "smite", "smote", "harlot", "whore", "bald"};

    private static boolean goodVerse(String b, int ch, String v) {
        if (skipChapter(b, ch)) return false;
        int n = v.length();
        if (n < 50 || n > 220) return false;
        char last = v.charAt(n - 1);
        if (last != '.' && last != '!' && last != '?') return false;
        String l = v.toLowerCase(Locale.US);
        for (String a : AVOID) if (l.contains(a)) return false;
        boolean hit = false;
        for (String w : WORDS) if (l.contains(w)) { hit = true; break; }
        if (!hit) return false;
        int sons = 0, i = 0;
        while ((i = l.indexOf("son of", i)) >= 0) { sons++; i += 6; }
        return sons < 2;
    }

    /** One verse per day, picked at random from the whole Bible (same verse all day). */
    public static Ref verseOfDay(long now) {
        if (text == null) return new Ref(18, 46, 10, "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.");
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        long seed = c.get(Calendar.YEAR) * 1000L + c.get(Calendar.DAY_OF_YEAR);
        java.util.Random r = new java.util.Random(seed * 2654435761L);
        for (int tries = 0; tries < 2000; tries++) {
            int b = r.nextInt(books.length);
            int ch = 1 + r.nextInt(text[b].length);
            String[] vs = text[b][ch - 1];
            int v = 1 + r.nextInt(vs.length);
            if (goodVerse(books[b], ch, vs[v - 1])) return new Ref(b, ch, v, vs[v - 1]);
        }
        return text.length > 18 && text[18].length > 45 ? new Ref(18, 46, 10, text[18][45][9]) : new Ref(0, 1, 1, text[0][0][0]);
    }

    /** Every verse that contains the word or phrase, up to max. */
    public static List<Ref> search(String q, int max) {
        List<Ref> out = new ArrayList<>();
        if (text == null || q == null) return out;
        String needle = q.trim().toLowerCase(Locale.US);
        if (needle.length() < 2) return out;
        boolean word = !needle.contains(" ");
        for (int b = 0; b < text.length; b++) {
            for (int ch = 0; ch < text[b].length; ch++) {
                String[] vs = text[b][ch];
                for (int v = 0; v < vs.length; v++) {
                    String l = vs[v].toLowerCase(Locale.US);
                    int i = l.indexOf(needle);
                    while (i >= 0) {
                        boolean ok = true;
                        if (word) {
                            char before = i > 0 ? l.charAt(i - 1) : ' ';
                            int end = i + needle.length();
                            char after = end < l.length() ? l.charAt(end) : ' ';
                            ok = !Character.isLetter(before) && !Character.isLetter(after);
                        }
                        if (ok) { out.add(new Ref(b, ch + 1, v + 1, vs[v])); break; }
                        i = l.indexOf(needle, i + 1);
                    }
                    if (out.size() >= max) return out;
                }
            }
        }
        return out;
    }

    public static int count(String q) {
        return search(q, 100000).size();
    }
}
