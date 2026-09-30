package com.breakaway.race;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowManager;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** A trusted local game, not an arbitrary remote WebView with a privileged bridge. */
public final class MainActivity extends Activity {
    private static final String ORIGIN="https://app.breakaway.local";
    private static final int MIC=100, EXPORT=101;
    private WebView web;
    private BikeSensors sensors;
    private VoiceEngine voice;
    private boolean resumed, sensorRequested, pendingOnline;
    private String exportData;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        sensors=new BikeSensors(this,data->emit("breakaway-bike",data));
        voice=new VoiceEngine(this,data->emit("breakaway-voice",data));
        web=new WebView(this);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(BuildConfig.DEBUG?WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE:WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(),"BreakawayBridge");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !trusted(request.getUrl());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(!trusted(uri))return null;
                String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
                if(path.contains("..")||path.contains("\\")||!path.matches("/[a-zA-Z0-9_./-]+"))return error(403,"Forbidden");
                try{String mime=path.endsWith(".html")?"text/html":path.endsWith(".mjs")||path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".json")||path.endsWith(".webmanifest")?"application/json":"application/octet-stream";
                    Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");
                    headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:"+(BuildConfig.DEBUG?" http: ws:":"")+"; media-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open("game"+path));
                }catch(Exception error){return error(404,"Not found");}
            }
            @Override public void onPageFinished(WebView view,String url){if(url.startsWith(ORIGIN+"/"))reportCapabilities();}
        });
        setContentView(web);web.loadUrl(ORIGIN+"/index.html");
    }
    private static boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&"app.breakaway.local".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);}
    private static WebResourceResponse error(int code,String message){return new WebResourceResponse("text/plain","UTF-8",code,message,new HashMap<>(),new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));}
    private void emit(String name,JSONObject detail){runOnUiThread(()->{if(web!=null&&web.getUrl()!=null&&trusted(Uri.parse(web.getUrl())))web.evaluateJavascript("window.dispatchEvent(new CustomEvent("+JSONObject.quote(name)+",{detail:"+detail.toString()+"}));",null);});}
    private void status(String state,String message){try{emit("breakaway-voice",new JSONObject().put("type","status").put("state",state).put("message",message));}catch(Exception ignored){}}
    private void reportCapabilities(){try{JSONObject object=new JSONObject().put("type","capabilities").put("model",Build.MODEL).put("android",Build.VERSION.RELEASE).put("sdk",Build.VERSION.SDK_INT).put("build",Build.DISPLAY).put("appVersion",BuildConfig.VERSION_NAME).put("microphone",getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE)).put("microphonePermission",checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED).put("platformSpeech",SpeechRecognizer.isRecognitionAvailable(this));
        try{object.put("webview",WebView.getCurrentWebViewPackage().versionName);}catch(Exception ignored){object.put("webview","unknown");}
        emit("breakaway-bike",object);}catch(Exception ignored){}}
    private void beginVoice(boolean allowOnline){if(!resumed)return;if(!getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE)){status("unavailable","This tablet reports no microphone. Pair a phone instead.");return;}
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){pendingOnline=allowOnline;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MIC);return;}voice.start(allowOnline);}
    @Override public void onRequestPermissionsResult(int request,String[] names,int[] grants){super.onRequestPermissionsResult(request,names,grants);if(request==MIC){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)beginVoice(pendingOnline);else status("denied","Microphone permission denied. Voice is off; other controls remain available.");reportCapabilities();}}
    @Override protected void onResume(){super.onResume();resumed=true;if(web!=null)web.onResume();if(sensorRequested)sensors.start();}
    @Override protected void onPause(){resumed=false;voice.stop();status("stopped","Microphone off while app is inactive");sensors.stop();if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){sensors.close();voice.close();if(web!=null){web.removeJavascriptInterface("BreakawayBridge");web.destroy();web=null;}super.onDestroy();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==EXPORT&&result==RESULT_OK&&data!=null&&data.getData()!=null&&exportData!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out!=null)out.write(exportData.getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}}exportData=null;}
    public final class Bridge {
        @JavascriptInterface public boolean isDebug(){return BuildConfig.DEBUG;}
        @JavascriptInterface public String getServerUrl(){return getPreferences(MODE_PRIVATE).getString("server","");}
        @JavascriptInterface public void setServerUrl(String raw){if(raw==null||raw.length()>300)return;try{Uri uri=Uri.parse(raw);boolean allowed="https".equals(uri.getScheme())||(BuildConfig.DEBUG&&"http".equals(uri.getScheme()));if(allowed&&uri.getHost()!=null&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null)getPreferences(MODE_PRIVATE).edit().putString("server",raw).apply();}catch(Exception ignored){}}
        @JavascriptInterface public void reportCapabilities(){runOnUiThread(MainActivity.this::reportCapabilities);}
        @JavascriptInterface public void startSensors(){runOnUiThread(()->{sensorRequested=true;if(resumed)sensors.start();});}
        @JavascriptInterface public void stopSensors(){runOnUiThread(()->{sensorRequested=false;sensors.stop();});}
        @JavascriptInterface public void startVoice(boolean allowOnline){runOnUiThread(()->beginVoice(allowOnline));}
        @JavascriptInterface public void stopVoice(){runOnUiThread(()->{voice.stop();status("stopped","Microphone off");});}
        @JavascriptInterface public void exportFile(String name,String text){if(name==null||text==null||text.length()>2000000)return;String safe=name.replaceAll("[^a-zA-Z0-9._-]","_");runOnUiThread(()->{if(exportData!=null)return;exportData=text;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(safe.endsWith(".csv")?"text/csv":"application/json").putExtra(Intent.EXTRA_TITLE,safe);try{startActivityForResult(intent,EXPORT);}catch(RuntimeException error){exportData=null;}});}
    }
}
