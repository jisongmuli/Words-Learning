package com.jisongmuli.wordslearning;

import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import org.json.*;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

/** A4, English on the left and Chinese on the right; Android embeds its CJK font. */
final class WordbookPdf {
    private static final int WIDTH=595, HEIGHT=842, LEFT=36, RIGHT=559, DIVIDER=209, BOTTOM=793;
    private final TextPaint english=paint(11,0xff26344c), chinese=paint(10,0xff475569), small=paint(9,0xff718096), heading=paint(18,0xff182d4e);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private PdfDocument document;
    private PdfDocument.Page page;
    private Canvas canvas;
    private int y, pageNumber;
    private String title;
    private int count;
    private static TextPaint paint(float size, int color) { TextPaint p=new TextPaint(Paint.ANTI_ALIAS_FLAG);p.setTextSize(size);p.setColor(color);p.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));return p; }
    private static StaticLayout layout(String text, TextPaint paint, int width) {
        return StaticLayout.Builder.obtain(text,0,text.length(),paint,width).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(3,1).build();
    }
    private void rectangle(int left,int top,int right,int bottom,int color) {fill.setColor(color);canvas.drawRect(left,top,right,bottom,fill);}
    private void draw(StaticLayout text, int x, int top) {canvas.save();canvas.translate(x,top);text.draw(canvas);canvas.restore();}
    private void begin() {
        page=document.startPage(new PdfDocument.PageInfo.Builder(WIDTH,HEIGHT,++pageNumber).create()); canvas=page.getCanvas();
        draw(layout(title,heading,RIGHT-LEFT),LEFT,32);
        String date=new SimpleDateFormat("yyyy-MM-dd",Locale.CHINA).format(new Date());
        canvas.drawText("共 "+count+" 个词条  ·  "+date,LEFT,77,small);
        rectangle(LEFT,91,RIGHT,120,0xffe9eef7);
        canvas.drawText("英文",LEFT+10,110,chinese);canvas.drawText("中文释义",DIVIDER+10,110,chinese);
        y=120;
    }
    private void finish() {
        canvas.drawText(title,LEFT,821,small);
        String number="第 "+pageNumber+" 页";canvas.drawText(number,RIGHT-small.measureText(number),821,small);
        document.finishPage(page);page=null;
    }
    void write(JSONObject book, OutputStream output) throws Exception {
        JSONArray words=book.getJSONArray("words");count=words.length();title=book.getString("title");pageNumber=0;
        if(count==0)throw new IOException("这本词书还没有词条。");
        document=new PdfDocument();
        try {
            begin();
            for(int i=0;i<count;i++) {
                JSONObject word=words.getJSONObject(i);
                StaticLayout en=layout(word.getString("english"),english,DIVIDER-LEFT-20);
                StaticLayout zh=layout(word.getString("chinese").replace("\\n","\n"),chinese,RIGHT-DIVIDER-20);
                int height=Math.max(en.getHeight(),zh.getHeight())+16;
                if(height>BOTTOM-120)throw new IOException("词条释义过长，无法放入单页："+word.getString("english"));
                if(y+height>BOTTOM){finish();begin();}
                rectangle(LEFT,y,RIGHT,y+height,i%2==0?0xffffffff:0xfff8fafc);
                draw(en,LEFT+10,y+8);draw(zh,DIVIDER+10,y+8);
                rectangle(LEFT,y+height-1,RIGHT,y+height,0xffe2e7ee);
                rectangle(DIVIDER,y,DIVIDER+1,y+height,0xffe2e7ee);
                y+=height;
            }
            finish();document.writeTo(output);
        } finally {if(page!=null)document.finishPage(page);document.close();}
    }
}
