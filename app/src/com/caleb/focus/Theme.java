package com.caleb.focus;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Themes. Night: the starry sky and ice blue. Fall: your own photo as the background (it stays on the phone,
 * in Focus's private files) with warm amber accents and leaves drifting down.
 * Time with God keeps its dawn sky in every theme.
 */
public final class Theme {
    private Theme() { }

    public static final String NIGHT = "night", FALL = "fall";
    private static Bitmap photo;
    private static long photoStamp = -1;

    static SharedPreferences prefs(Context c) { return Store.get(c).prefs(); }

    public static String get(Context c) { return prefs(c).getString("theme", NIGHT); }
    public static boolean fall(Context c) { return FALL.equals(get(c)); }

    /** Bumped whenever the theme or its photo changes, so open screens know to redraw themselves. */
    public static int version(Context c) { return prefs(c).getInt("themeVersion", 0); }
    private static void bump(Context c) { prefs(c).edit().putInt("themeVersion", version(c) + 1).apply(); }

    public static void set(Context c, String theme) {
        prefs(c).edit().putString("theme", theme).apply();
        bump(c);
        apply(c);
    }

    /** The colours that follow the theme. */
    public static void apply(Context c) {
        if (fall(c)) {
            Ui.ICE = 0xFFF0B27A;        // amber
            Ui.ICE_SOFT = 0xFFF8D9B8;
            Ui.BG = 0xFF0D0907;
        } else {
            Ui.ICE = 0xFFAACFF6;
            Ui.ICE_SOFT = 0xFFCFE0FA;
            Ui.BG = 0xFF07090E;
        }
        Ui.BORDER_ICE = Ui.ice(0x1F);
    }

    static File photoFile(Context c) { return new File(c.getFilesDir(), "theme_photo.jpg"); }
    public static boolean hasPhoto(Context c) { return photoFile(c).exists(); }

    /** The chosen photo, decoded once and kept while it's unchanged. */
    public static synchronized Bitmap photo(Context c) {
        File f = photoFile(c);
        if (!f.exists()) { photo = null; photoStamp = -1; return null; }
        if (photo == null || photoStamp != f.lastModified()) {
            photo = BitmapFactory.decodeFile(f.getAbsolutePath());
            photoStamp = f.lastModified();
        }
        return photo;
    }

    /** Copies a picked photo into Focus's own files, upright and no bigger than 2400 px on the long side. */
    public static void savePhoto(Context c, Uri uri) throws Exception {
        ImageDecoder.Source src = ImageDecoder.createSource(c.getContentResolver(), uri);
        Bitmap b = ImageDecoder.decodeBitmap(src, new ImageDecoder.OnHeaderDecodedListener() {
            @Override public void onHeaderDecoded(ImageDecoder d, ImageDecoder.ImageInfo info, ImageDecoder.Source s) {
                int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                float k = Math.min(1f, 2400f / Math.max(w, h));
                d.setTargetSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
                d.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                // convert wide-gamut photos (Display P3, Adobe RGB) to sRGB so the saved JPEG keeps its true colours
                d.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
            }
        });
        File tmp = new File(c.getFilesDir(), "theme_photo.tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        try { b.compress(Bitmap.CompressFormat.JPEG, 90, out); } finally { out.close(); }
        if (!tmp.renameTo(photoFile(c))) throw new Exception("could not save the photo");
        bump(c);
    }
}
