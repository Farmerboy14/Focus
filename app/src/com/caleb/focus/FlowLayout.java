package com.caleb.focus;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;

/** Lays children out left to right and wraps to new rows. */
public class FlowLayout extends ViewGroup {
    private final int gap;

    public FlowLayout(Context c, int gapPx) {
        super(c);
        gap = gapPx;
    }

    @Override
    protected void onMeasure(int wSpec, int hSpec) {
        int maxW = MeasureSpec.getSize(wSpec) - getPaddingLeft() - getPaddingRight();
        int x = 0, y = 0, rowH = 0;
        for (int i = 0; i < getChildCount(); i++) {
            View ch = getChildAt(i);
            if (ch.getVisibility() == GONE) continue;
            ch.measure(MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
            int cw = ch.getMeasuredWidth(), chh = ch.getMeasuredHeight();
            if (x > 0 && x + cw > maxW) { x = 0; y += rowH + gap; rowH = 0; }
            x += cw + gap;
            rowH = Math.max(rowH, chh);
        }
        setMeasuredDimension(MeasureSpec.getSize(wSpec), y + rowH + getPaddingTop() + getPaddingBottom());
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        int maxW = r - l - getPaddingLeft() - getPaddingRight();
        int x = 0, y = 0, rowH = 0;
        for (int i = 0; i < getChildCount(); i++) {
            View ch = getChildAt(i);
            if (ch.getVisibility() == GONE) continue;
            int cw = ch.getMeasuredWidth(), chh = ch.getMeasuredHeight();
            if (x > 0 && x + cw > maxW) { x = 0; y += rowH + gap; rowH = 0; }
            ch.layout(getPaddingLeft() + x, getPaddingTop() + y, getPaddingLeft() + x + cw, getPaddingTop() + y + chh);
            x += cw + gap;
            rowH = Math.max(rowH, chh);
        }
    }
}
