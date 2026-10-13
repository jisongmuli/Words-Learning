package com.jisongmuli.wordslearning;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net";
    private static final int FILE_REQUEST=41, MAX_BACKUP=8*1024*1024;
    private WebView web;
    private StudyStorage storage;
    private final ExecutorService files=Executors.newSingleThreadExecutor();
    private String pendingId, pendingAction, pendingPayload;
    private long lastBack;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        storage=new StudyStorage(getFilesDir());
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(245,247,252));
        web=new WebView(this);web.setBackgroundColor(Color.rgb(245,247,252));
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30) {
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
                v.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            } else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        root.requestApplyInsets();
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setTextZoom(100);settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        web.addJavascriptInterface(new Bridge(),"AndroidStudy");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();
                if(!isLocal(uri)) return response(403,"Blocked","text/plain",new byte[0]);
                String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
                if(path.contains("..")||path.contains("\\")||!request.getMethod().equals("GET"))return response(403,"Blocked","text/plain",new byte[0]);
                try {
                    InputStream input=getAssets().open(path.substring(1));
                    String mime=path.endsWith(".mjs")||path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".json")?"application/json":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".html")?"text/html":"text/plain";
                    Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-cache");
                    headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,input);
                } catch(IOException error){return response(404,"Not Found","text/plain",new byte[0]);}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();if(isLocal(uri))return false;
                if(request.isForMainFrame()&&request.hasGesture()&&("https".equals(uri.getScheme())||"http".equals(uri.getScheme()))) {
                    try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){Toast.makeText(MainActivity.this,"设备上没有可用的浏览器",Toast.LENGTH_SHORT).show();}
                }
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail) {
                new AlertDialog.Builder(MainActivity.this).setTitle("页面需要重新打开").setMessage("已保存的进度仍在设备上。").setPositiveButton("重新打开",(d,w)->recreate()).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl(ORIGIN+"/");
    }
    private static boolean isLocal(Uri uri){return "https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&uri.getPort()==-1;}
    private static WebResourceResponse response(int status,String reason,String type,byte[] bytes){return new WebResourceResponse(type,"UTF-8",status,reason,Collections.emptyMap(),new ByteArrayInputStream(bytes));}
    private static JSONObject result(boolean ok,String value,String error){JSONObject r=new JSONObject();try{r.put("ok",ok);if(value!=null)r.put("value",value);if(error!=null)r.put("error",error);}catch(JSONException ignored){}return r;}
    private final class Bridge {
        @JavascriptInterface public String loadState(){try{return result(true,storage.read(),null).toString();}catch(Exception e){return result(false,null,"无法读取学习数据，请保留应用并重试。").toString();}}
        @JavascriptInterface public String saveState(String json,boolean importing){try{storage.write(json,importing);return result(true,null,null).toString();}catch(Exception e){return result(false,null,"未能保存到设备，请检查剩余存储空间后重试。").toString();}}
        @JavascriptInterface public void fileOperation(String id,String action,String payload){runOnUiThread(()->openFile(id,action,payload));}
    }
    private void openFile(String id,String action,String payload){
        if(pendingId!=null){deliver(id,result(false,null,"请先完成当前文件操作。"));return;}
        try{
            Intent intent;
            if(action.equals("import")) {intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("*/*");}
            else {
                intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                if(action.equals("pdf")) {JSONObject book=new JSONObject(payload);if(book.getJSONArray("words").length()==0)throw new IOException("这本词书还没有词条。");intent.setType("application/pdf");intent.putExtra(Intent.EXTRA_TITLE,book.getString("title")+".pdf");}
                else if(action.equals("backup")){intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,"拾词学习备份.json");}
                else throw new IOException("文件操作不正确。");
            }
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            pendingId=id;pendingAction=action;pendingPayload=payload;
            startActivityForResult(intent,FILE_REQUEST);
        }catch(Exception e){pendingId=null;pendingPayload=null;deliver(id,result(false,null,"无法打开文件选择器："+e.getMessage()));}
    }
    @Override protected void onActivityResult(int request,int status,Intent data){
        super.onActivityResult(request,status,data);
        if(request!=FILE_REQUEST||pendingId==null)return;
        String id=pendingId,action=pendingAction,payload=pendingPayload;
        if(status!=RESULT_OK||data==null||data.getData()==null){pendingId=null;pendingPayload=null;JSONObject r=result(true,null,null);try{r.put("cancelled",true);}catch(JSONException ignored){}deliver(id,r);return;}
        Uri uri=data.getData();
        files.execute(()->{
            JSONObject answer;
            try {
                if(action.equals("import")) {
                    try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){
                        if(in==null)throw new IOException("无法读取文件。");
                        byte[] buffer=new byte[8192];int read,total=0;
                        while((read=in.read(buffer))!=-1){total+=read;if(total>MAX_BACKUP)throw new IOException("备份文件超过 8 MB。");out.write(buffer,0,read);}
                        answer=result(true,out.toString("UTF-8"),null);
                    }
                } else {
                    try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")) {
                        if(out==null)throw new IOException("无法写入所选位置。");
                        if(action.equals("pdf"))new WordbookPdf().write(new JSONObject(payload),out);
                        else out.write(payload.getBytes(StandardCharsets.UTF_8));
                    }
                    answer=result(true,null,null);
                }
            }catch(Exception e){answer=result(false,null,"文件操作失败："+e.getMessage());}
            JSONObject completed=answer;
            runOnUiThread(()->{pendingId=null;pendingPayload=null;deliver(id,completed);});
        });
    }
    private void deliver(String id,JSONObject answer){if(!isFinishing()&&!isDestroyed())web.evaluateJavascript("window.onNativeFileResult && window.onNativeFileResult("+JSONObject.quote(id)+","+answer+")",null);}
    @Override public void onBackPressed(){
        web.evaluateJavascript("typeof window.handleAndroidBack === 'function' ? window.handleAndroidBack() : false",handled->{
            if("true".equals(handled))return;
            long now=System.currentTimeMillis();
            if(now-lastBack<2000)super.onBackPressed();
            else{lastBack=now;Toast.makeText(this,"再按一次返回退出拾词",Toast.LENGTH_SHORT).show();}
        });
    }
    @Override protected void onDestroy(){super.onDestroy();files.shutdown();if(web!=null){web.removeJavascriptInterface("AndroidStudy");web.destroy();}}
}
