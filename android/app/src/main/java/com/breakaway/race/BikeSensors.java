package com.breakaway.race;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Parcel;
import android.os.RemoteException;
import android.os.SystemClock;
import org.json.JSONObject;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Read-only interoperability adapter. No resistance, fake-data, calibration, bootloader,
 * update, or fitness-content calls exist in this class. Documentation: docs/COMPATIBILITY.md.
 * The callback contains a single nullable Parcelable. We consume only its fixed 40-byte
 * header, not firmware-dependent strings/arrays in its tail. The entire callback parcel is
 * then discarded. A schema change fails validation rather than being guessed.
 *
 * This implementation is NOT physically certified on any Peloton. Upstream reference
 * observations are evidence for the protocol, not tests of this application. */
public final class BikeSensors {
    static final String PACKAGE = "com.onepeloton.affernetservice";
    private final Context context;
    private final Consumer<JSONObject> output;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService worker = Executors.newScheduledThreadPool(2);
    private final Endpoint v1 = new Endpoint("IV1Interface", "IV1Callback", 1, 2, "peloton-v1");
    private final Endpoint bike = new Endpoint("IBikeInterface", "IBikeCallback", 15, 16, "peloton-bike");
    private volatile boolean running;
    private volatile long startedAt;
    private volatile long lastFrame;
    private volatile String active;
    private long lastEmit;
    private long sequence;
    private final AtomicBoolean pollBusy = new AtomicBoolean(false);

    public BikeSensors(Context context, Consumer<JSONObject> output) {
        this.context = context.getApplicationContext(); this.output = output;
        worker.scheduleAtFixedRate(this::watch, 1, 1, TimeUnit.SECONDS);
    }
    public synchronized void start() {
        if (running) return;
        running = true; active = null; lastFrame = 0; startedAt = SystemClock.elapsedRealtime();
        status("probing", "Waiting for real sensor frames from V1 and Bike interfaces");
        main.post(() -> { if(running) { v1.bind(); bike.bind(); } });
    }
    public synchronized void stop() {
        running = false; active = null; lastFrame = 0;
        main.post(() -> { if(!running) { v1.unbind(); bike.unbind(); } });
        status("stopped", "Bike sensors stopped; no measurements are being forwarded");
    }
    public void close() { stop(); worker.shutdown(); }
    private synchronized void accept(Endpoint endpoint, BikeSample sample, boolean polled) {
        if (!running) return;
        long now = SystemClock.elapsedRealtime();
        if (active != null && !active.equals(endpoint.source) && now - lastFrame < 2500) return;
        active = endpoint.source; lastFrame = now; endpoint.lastValid = now;
        // Avoid flooding WebView on boards reporting at 20+ Hz. Sample age is never renewed by a timer.
        if (now - lastEmit < 80) return;
        lastEmit = now;
        try {
            JSONObject object = new JSONObject().put("type", "telemetry").put("watts", sample.watts)
                .put("cadence", sample.cadence).put("resistance", sample.resistance)
                .put("source", polled ? "peloton-poll" : endpoint.source).put("seq", ++sequence);
            output.accept(object);
        } catch (Exception ignored) { status("invalid", "Unable to encode a sensor sample"); }
    }
    private void watch() {
        if (!running) return;
        long now = SystemClock.elapsedRealtime();
        boolean silent = lastFrame == 0 ? now - startedAt > 5000 : now - lastFrame > 2500;
        if (silent) {
            status("stale", "No recent valid sensor frames. Virtual propulsion is disabled; retrying read-only providers.");
            if (bike.remote != null && pollBusy.compareAndSet(false, true)) {
                try { bike.poll(); } finally { pollBusy.set(false); }
            }
            main.post(() -> { if(running) { if (!v1.bound) v1.bind(); if (!bike.bound) bike.bind(); } });
        }
    }
    private void status(String state, String message) {
        try { output.accept(new JSONObject().put("type", "status").put("state", state).put("message", message)); }
        catch (Exception ignored) { /* UI reporting must not crash a lifecycle callback. */ }
    }
    static BikeSample decodeHeader(Parcel parcel) {
        if (parcel.dataAvail() < 4) throw new IllegalArgumentException("Missing nullable frame marker");
        if (parcel.readInt() == 0) throw new IllegalArgumentException("Null frame");
        if (parcel.dataAvail() < 40) throw new IllegalArgumentException("Truncated fixed sensor header");
        long rpm = parcel.readLong(), power = parcel.readLong();
        parcel.readLong(); // stepper position: deliberately not exposed or modified
        parcel.readLong(); // load-cell reading: deliberately not exposed or modified
        int resistance = parcel.readInt(); parcel.readInt(); // target resistance is not used
        return BikeSample.fromHeader(rpm, power, resistance);
    }
    private final class Endpoint implements ServiceConnection {
        final String descriptor, callbackDescriptor, source;
        final int registerCode, unregisterCode;
        volatile IBinder remote;
        volatile boolean bound;
        volatile long lastValid;
        long nextBind;
        int failures;
        final IBinder.DeathRecipient death = () -> disconnected("Sensor process restarted");
        final Binder callback;
        Endpoint(String iface, String callbackName, int register, int unregister, String source) {
            this.descriptor = PACKAGE + "." + iface; this.callbackDescriptor = PACKAGE + "." + callbackName;
            this.registerCode = register; this.unregisterCode = unregister; this.source = source;
            this.callback = new Binder() {
                @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
                    if (code == INTERFACE_TRANSACTION) { if (reply != null) reply.writeString(callbackDescriptor); return true; }
                    if (!running) return true;
                    try {
                        data.enforceInterface(callbackDescriptor);
                        if (code == 1) { accept(Endpoint.this, decodeHeader(data), false); return true; }
                        if (code == 2) { if (active != null && active.equals(source)) lastFrame = 0; status("sensor-error", "The sensor service reported an error"); return true; }
                        if (code == 3) return true; // calibration notification; no calibration is requested
                        return false; // Unknown transactions are never guessed.
                    } catch (RuntimeException error) { status("invalid", source + ": invalid or changed sensor schema"); return false; }
                }
            };
        }
        void bind() {
            if (!running || bound || SystemClock.elapsedRealtime() < nextBind) return;
            try {
                Intent intent = new Intent(descriptor).setPackage(PACKAGE);
                bound = context.bindService(intent, this, Context.BIND_AUTO_CREATE);
                if (!bound) failed("No exported " + source + " service available");
            } catch (SecurityException error) { failed("Firmware denies " + source + " sensor access"); }
            catch (RuntimeException error) { failed("Unable to bind " + source); }
        }
        void failed(String message) {
            failures++; nextBind = SystemClock.elapsedRealtime() + Math.min(30000, 1000L << Math.min(5, failures));
            if (active == null) status("unavailable", message);
        }
        void disconnected(String message) {
            remote = null;
            if (source.equals(active)) { active = null; lastFrame = 0; status("disconnected", message); }
            main.post(() -> { unbind(); if (running) bind(); });
        }
        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            if (!running) { unbind(); return; }
            remote = service;
            worker.execute(() -> {
                try {
                    // A descriptor mismatch fails closed before any transaction is sent.
                    if (!descriptor.equals(service.getInterfaceDescriptor())) throw new RemoteException("Descriptor mismatch");
                    service.linkToDeath(death, 0);
                    if(!running || remote!=service) return;
                    transactSubscription(service, registerCode);
                    failures = 0;
                } catch (RemoteException | RuntimeException error) { disconnected("Sensor subscription failed for " + source); }
            });
        }
        @Override public void onServiceDisconnected(ComponentName name) { disconnected("Sensor service disconnected"); }
        @Override public void onBindingDied(ComponentName name) { disconnected("Sensor binding died"); }
        @Override public void onNullBinding(ComponentName name) { disconnected("Sensor service returned a null binder"); }
        void transactSubscription(IBinder service, int transaction) throws RemoteException {
            if (!descriptor.equals(service.getInterfaceDescriptor())) throw new RemoteException("Descriptor mismatch");
            Parcel request = Parcel.obtain(), reply = Parcel.obtain();
            try {
                request.writeInterfaceToken(descriptor); request.writeStrongBinder(callback);
                request.writeString(context.getPackageName());
                if (!service.transact(transaction, request, reply, 0)) throw new RemoteException("Unsupported transaction");
                reply.readException();
            } finally { request.recycle(); reply.recycle(); }
        }
        void poll() {
            IBinder service = remote; if (service == null || !running) return;
            Parcel request = Parcel.obtain(), reply = Parcel.obtain();
            try {
                if (!descriptor.equals(service.getInterfaceDescriptor())) return;
                request.writeInterfaceToken(descriptor);
                // Documented IBikeInterface.getBikeData. This endpoint never sends a resistance command.
                if (!service.transact(14, request, reply, 0)) return;
                reply.readException(); accept(this, decodeHeader(reply), true);
            } catch (RemoteException | RuntimeException error) { if(source.equals(active)) lastFrame=0; }
            finally { request.recycle(); reply.recycle(); }
        }
        void unbind() {
            IBinder old = remote; remote = null;
            if (old != null) {
                try { old.unlinkToDeath(death, 0); } catch(RuntimeException ignored) { }
                if (!worker.isShutdown()) worker.execute(() -> { try { transactSubscription(old, unregisterCode); } catch(Exception ignored) { } });
            }
            if (bound) { try { context.unbindService(this); } catch (IllegalArgumentException ignored) { } }
            bound = false;
        }
    }
}
