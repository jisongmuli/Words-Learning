package com.jisongmuli.wordslearning;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.WebView;
import android.graphics.pdf.PdfRenderer;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** Run only on a disposable emulator: installs exercise data in the debug app. */
public class SmokeTest extends Instrumentation {
    private WebView web;
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    private WebView findWeb(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView found=findWeb(group.getChildAt(i));if(found!=null)return found;}}return null;}
    private Activity launch() throws Exception {
        Intent intent=new Intent(getTargetContext(),MainActivity.class);intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity=startActivitySync(intent);runOnMainSync(()->web=findWeb(activity.getWindow().getDecorView()));
        for(int i=0;i<200;i++){if("true".equals(js("!!document.querySelector('[data-book=cet4]')")))return activity;Thread.sleep(50);}
        throw new AssertionError("UI failed to load: "+js("document.body.innerText"));
    }
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,value->{result.set(value);latch.countDown();}));
        if(!latch.await(10,TimeUnit.SECONDS))throw new AssertionError("JavaScript timed out");return result.get();
    }
    private void async(String script) throws Exception {
        js("window.__testResult=null;(async()=>{"+script+"})().then(()=>window.__testResult='PASS').catch(e=>window.__testResult='FAIL: '+e.stack)");
        for(int i=0;i<600;i++) {String value=js("window.__testResult");if(!"null".equals(value)){if(!"\"PASS\"".equals(value))throw new AssertionError(value);return;}Thread.sleep(50);}
        throw new AssertionError("Async test timed out: "+js("document.body.innerText"));
    }
    @Override public void onStart(){
        Bundle output=new Bundle();
        try {
            Activity first=launch();
            async("""
                const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('UI wait timed out');};
                const assert=(v,m)=>{if(!v)throw Error(m);};
                document.querySelector('.setting-chip').click();
                document.querySelector('#batch-size').value='7';document.querySelector('#settings-form').requestSubmit();
                await wait(()=>!document.querySelector('#settings-dialog').open);
                document.querySelector('[data-action=start][data-book=cet4]').click();
                await wait(()=>document.querySelectorAll('[data-word]').length===7);
                const boxes=document.querySelectorAll('[data-word]');boxes[0].click();
                document.querySelector('[data-action=reveal]').click();
                await wait(()=>document.querySelectorAll('.meaning').length===7);
                document.querySelectorAll('[data-word]')[1].click();
                const {mobileEngine}=await import('https://appassets.androidplatform.net/platform.js'), engine=await mobileEngine();
                const firstId=engine.state.progress.cet4.current.id;
                document.querySelector('[data-action=complete]').click();
                await wait(()=>engine.state.progress.cet4.current?.id!==firstId && document.querySelector('[data-action=reveal]'));
                assert(engine.bootstrap().unknownBook.count===2,'Corrected selection lost');
                assert(engine.state.progress.cet4.seen.length===7,'Progress incorrect');
                document.querySelectorAll('[data-word]')[2].click();
                await wait(()=>engine.state.progress.cet4.current.selected.length===1);
                assert(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');
                window.__resumeId=engine.state.progress.cet4.current.id;
                """);
            String resume=js("window.__resumeId");
            runOnMainSync(first::finish);waitForIdleSync();launch();
            async("""
                const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Resume wait timed out');};
                document.querySelector('[data-action=continue]').click();await wait(()=>document.querySelectorAll('[data-word]').length===7);
                if(document.querySelectorAll('[data-word]:checked').length!==1)throw Error('Selection did not survive Activity restart');
                const {mobileEngine}=await import('https://appassets.androidplatform.net/platform.js'),engine=await mobileEngine();
                window.__resumeId=engine.state.progress.cet4.current.id;
                """);
            if(!resume.equals(js("window.__resumeId")))throw new AssertionError("Session changed on restart");
            async("""
                const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Reset wait timed out');};
                document.querySelector('[data-action=reset-book]').click();
                document.querySelector('#confirm-action').click();
                await wait(()=>!document.querySelector('#confirm-dialog').open);
                const {mobileEngine}=await import('https://appassets.androidplatform.net/platform.js'),engine=await mobileEngine();
                if(engine.state.progress.cet4.seen.length!==0 || engine.bootstrap().unknownBook.count!==2 || engine.bootstrap().totalCount!==7)throw Error('Reset affected retained records');
                window.handleAndroidBack();await wait(()=>document.querySelector('[data-action=browse][data-book=cet4]'));
                document.querySelector('[data-action=browse][data-book=cet4]').click();await wait(()=>document.querySelector('#word-search'));
                document.querySelector('#word-search').value='abandon';document.querySelector('#search-form').requestSubmit();
                if(!document.querySelector('.word-table').innerText.includes('abandon'))throw Error('Search failed');
                const backup=engine.exportState();try{engine.previewImport('{}');throw Error('Bad backup accepted');}catch(e){if(e.message==='Bad backup accepted')throw e;}
                engine.importState(engine.previewImport(backup));
                if(engine.bootstrap().unknownBook.count!==2)throw Error('Backup restore lost words');
                """);
            for(String id:new String[]{"cet6","phrases"}){
                String json;try(InputStream in=getTargetContext().getAssets().open("books/"+id+".json")){json=new String(in.readAllBytes(),StandardCharsets.UTF_8);}
                File file=new File(getTargetContext().getExternalFilesDir(null),"test-"+id+".pdf");
                try(FileOutputStream out=new FileOutputStream(file)){new WordbookPdf().write(new JSONObject(json),out);}
                try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);PdfRenderer renderer=new PdfRenderer(fd)){
                    if(renderer.getPageCount()<2)throw new AssertionError("PDF missing pages");
                    output.putInt(id+"PdfPages",renderer.getPageCount());
                }
            }
            output.putString("stream","PASS: Native WebView touch flow, 7-word batch, reveal/correction, persistent resume, isolated reset, search, native file storage, backup restore and two CJK PDF exports.");
            finish(Activity.RESULT_OK,output);
        }catch(Throwable error){output.putString("stream","FAIL: "+error);finish(Activity.RESULT_CANCELED,output);}
    }
}
