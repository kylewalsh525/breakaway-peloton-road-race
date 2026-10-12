package com.breakaway.race;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.SpeechService;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Offline first. Audio never goes to the race server. Platform speech is an explicit opt-in,
 * since recognition services may send audio to their own provider. Partial results never act. */
public final class VoiceEngine {
    private final Context context;
    private final Consumer<JSONObject> output;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile int generation;
    private volatile boolean running;
    private Model model;
    private Recognizer recognizer;
    private SpeechService service;
    private SpeechRecognizer platform;
    private int retries;
    private long utterance;
    private int platformAttempt;
    private boolean platformLocal;
    private String clientSession;
    private String lastPartial = "";
    // Keep these phrases aligned with shared/voice.mjs; tested by voice-native-contract.test.mjs.
    private final String[] commands = {"left","go left","move left","right","go right","move right","center","centre","middle","hit","punch","attack","chain","swing chain","kick","block","shield","defend","boost","turbo","sprint","brake","brakes","slow","coast","stop","pause","resume","ride","ready","start"};
    public VoiceEngine(Context context, Consumer<JSONObject> output) { this.context=context;this.output=output; }
    public void start(boolean allowOnline) {
        start(allowOnline,null);
    }
    public void start(boolean allowOnline,String sessionId) {
        stop(); clientSession=sessionId; lastPartial=""; running=true; int id=generation;
        status("starting", "Loading offline speech model…");
        worker.execute(() -> {
            try {
                File directory = new File(context.getFilesDir(), "voice-model-0.15");
                if (!new File(directory,"READY").isFile()) {
                    copyAssets("model",directory);
                    if(!new File(directory,"am/final.mdl").isFile()) throw new IllegalStateException("Offline model was not packaged");
                    new File(directory,"READY").createNewFile();
                }
                Model loaded = new Model(directory.getAbsolutePath());
                main.post(() -> {
                    if(!running || id!=generation) { loaded.close(); return; }
                    try {
                        model=loaded; JSONArray grammar=new JSONArray();
                        for(String word:commands) { grammar.put(word);grammar.put("rider "+word); }
                        grammar.put("[unk]");
                        recognizer = new Recognizer(model,16000f,grammar.toString()); recognizer.setWords(true);
                        service = new SpeechService(recognizer,16000f);
                        service.startListening(new org.vosk.android.RecognitionListener() {
                            public void onPartialResult(String hypothesis){emitVosk(hypothesis,false,id);}
                            public void onResult(String hypothesis){emitVosk(hypothesis,true,id);}
                            public void onFinalResult(String hypothesis){emitVosk(hypothesis,true,id);}
                            public void onError(Exception error){ if(id==generation){stop();status("unavailable","Offline microphone failed: "+error.getClass().getSimpleName());} }
                            public void onTimeout(){ if(id==generation){stop();status("stopped","Voice session ended");} }
                        });
                        status("listening","Listening · offline Vosk · audio stays on this tablet");
                    } catch(Exception error) { stop();status("unavailable","Offline recognizer could not start. Check microphone permission and model packaging."); }
                });
            } catch(Exception error) {
                main.post(() -> { if(!running||id!=generation)return;
                    if(allowOnline) startPlatform(id);
                    else {running=false;status("unavailable","Offline model missing or incompatible. Run the Android model preparation script, or explicitly allow platform speech in Voice Setup.");}
                });
            }
        });
    }
    private void copyAssets(String path,File dest) throws Exception {
        String[] children=context.getAssets().list(path);
        if(children==null)throw new IllegalStateException("Missing assets");
        if(children.length==0) {
            File parent=dest.getParentFile();if(parent!=null&&!parent.isDirectory()&&!parent.mkdirs())throw new IllegalStateException("Model storage unavailable");
            try(InputStream in=context.getAssets().open(path);FileOutputStream out=new FileOutputStream(dest)){byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);}
        } else {if(!dest.isDirectory()&&!dest.mkdirs())throw new IllegalStateException("Model storage unavailable");for(String child:children)copyAssets(path+"/"+child,new File(dest,child));}
    }
    private void emitVosk(String raw,boolean finalResult,int id) {
        if(!running||id!=generation)return;
        try {JSONObject result=new JSONObject(raw);String text=result.optString(finalResult?"text":"partial","");if(text.isEmpty())return;
            if(!finalResult) { if(text.equals(lastPartial))return; lastPartial=text; }
            else lastPartial="";
            double confidence=1;JSONArray words=result.optJSONArray("result");
            if(words!=null&&words.length()>0){confidence=1;for(int i=0;i<words.length();i++)confidence=Math.min(confidence,words.getJSONObject(i).optDouble("conf",0));}
            // Word timestamps identify the audio span, so a repeated final callback
            // retains its utterance ID instead of being mistaken for a second attack.
            double from=words!=null&&words.length()>0?words.getJSONObject(0).optDouble("start",-1):-1;
            double to=words!=null&&words.length()>0?words.getJSONObject(words.length()-1).optDouble("end",-1):-1;
            String key=finalResult&&from>=0&&to>=from
                ? "vosk-"+id+"-"+from+"-"+to : "vosk-"+id+"-"+(++utterance);
            emit(text,confidence,finalResult,key);
        }catch(Exception ignored){ }
    }
    private void startPlatform(int id) {
        if(!SpeechRecognizer.isRecognitionAvailable(context)){running=false;status("unavailable","No platform speech service. Package the offline Vosk model or pair a phone.");return;}
        try {
            platformLocal=Build.VERSION.SDK_INT>=31&&SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
            platform=platformLocal?SpeechRecognizer.createOnDeviceSpeechRecognizer(context):SpeechRecognizer.createSpeechRecognizer(context);
            retries=0;
            listenPlatform(id);
        } catch(RuntimeException error) { stop();status("unavailable","Platform speech could not initialize; use offline Vosk or pair a phone."); }
    }
    private void listenPlatform(int id) {
        if(!running||id!=generation||platform==null)return;
        final int attempt=++platformAttempt;
        try {
            platform.setRecognitionListener(new RecognitionListener(){
                private boolean complete;
                private boolean current(){return running&&id==generation&&attempt==platformAttempt&&!complete;}
                public void onReadyForSpeech(Bundle p){if(current())status("listening",platformLocal?"Listening · Android on-device speech":"Listening · platform service may process audio online");}
                public void onBeginningOfSpeech(){} public void onRmsChanged(float v){} public void onBufferReceived(byte[] b){} public void onEndOfSpeech(){}
                public void onError(int code){
                    if(!current())return;complete=true;
                    if(code==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS){stop();status("denied","Microphone permission denied");return;}
                    // Silence and an unrecognized phrase are normal during a race.
                    if(code==SpeechRecognizer.ERROR_NO_MATCH||code==SpeechRecognizer.ERROR_SPEECH_TIMEOUT){main.postDelayed(()->listenPlatform(id),150);return;}
                    retries++;if(retries>=8){stop();status("unavailable","Speech service repeatedly failed; pair a phone or use offline Vosk");return;}
                    status("retrying","Speech service interrupted; reconnecting…");
                    main.postDelayed(()->listenPlatform(id),Math.min(8000,500L*retries));
                }
                public void onResults(Bundle results){
                    if(!current())return;complete=true;retries=0;
                    ArrayList<String> list=results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    float[] confidence=results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                    if(list!=null&&!list.isEmpty())emit(list.get(0),confidence!=null&&confidence.length>0&&confidence[0]>=0?confidence[0]:0.6,true,"platform-"+id+"-"+attempt);
                    main.postDelayed(()->listenPlatform(id),150);
                }
                public void onPartialResults(Bundle results){} public void onEvent(int code,Bundle b){}
            });
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-US").putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,false);
            platform.startListening(intent);
        }catch(RuntimeException error){stop();status("unavailable","Platform speech failed to start");}
    }
    private synchronized void emit(String text,double confidence,boolean finalResult,String utteranceId){try{output.accept(new JSONObject().put("type","result").put("text",text).put("confidence",confidence).put("final",finalResult).put("utteranceId",utteranceId).put("sessionId",clientSession));}catch(Exception ignored){}}
    private void status(String state,String message){try{output.accept(new JSONObject().put("type","status").put("state",state).put("message",message).put("sessionId",clientSession));}catch(Exception ignored){}}
    public void stop(){running=false;generation++;main.removeCallbacksAndMessages(null);if(platform!=null){platform.cancel();platform.destroy();platform=null;}if(service!=null){service.stop();service.shutdown();service=null;}if(recognizer!=null){recognizer.close();recognizer=null;}if(model!=null){model.close();model=null;}}
    public void close(){stop();worker.shutdown();}
}
