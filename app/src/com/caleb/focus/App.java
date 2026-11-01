package com.caleb.focus;

import android.app.Application;
import android.content.Context;

import java.io.PrintWriter;
import java.io.StringWriter;

public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        final Context ctx = getApplicationContext();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    StringWriter sw = new StringWriter();
                    e.printStackTrace(new PrintWriter(sw));
                    String s = sw.toString();
                    if (s.length() > 6000) s = s.substring(0, 6000);
                    ctx.getSharedPreferences("focus", MODE_PRIVATE).edit()
                            .putString("lastCrash", new java.util.Date().toString() + "\n" + s).commit();
                } catch (Throwable ignored) { }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }
}
