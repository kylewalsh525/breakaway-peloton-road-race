import { TelemetryMux, decodeCyclingPower, decodeIndoorBike } from '../shared/telemetry.mjs';
export class BikeController extends EventTarget {
    constructor() {
        super();
        this.mux = new TelemetryMux();
        this.mode = 'demo';
        this.demoWatts = 200;
        this.seq = 0;
        this.bluetooth = null;
        this.characteristic = null;
        this.native = null;
        this.crank = null;
        this.lastStatus = 'Demo power';
        this.nativeListener = e => {
            const data = e.detail;
            if (data?.type === 'telemetry') {
                if (this.mode !== 'peloton')
                    return;
                if (this.mux.selected !== data.source)
                    this.mux.select(data.source);
                this.mux.push({ ...data, seq: undefined });
                this.emit('status', { state: 'live', message: data.source });
            }
            else if (data?.type === 'status') {
                this.native = data;
                this.emit('status', data);
                if (data.state !== 'live' && this.mode === 'peloton')
                    this.mux.invalidate();
            }
            else if (data?.type === 'capabilities') {
                this.native = data;
                this.emit('capabilities', data);
            }
        };
        window.addEventListener('breakaway-bike', this.nativeListener);
        this.timer = setInterval(() => { if (this.mode === 'demo')
            this.mux.push({ watts: this.demoWatts, cadence: this.demoWatts > 0 ? 75 + this.demoWatts / 20 : 0, resistance: 35, source: 'demo', seq: this.seq++ }); }, 150);
    }
    emit(kind, detail) { this.dispatchEvent(new CustomEvent(kind, { detail })); }
    async select(mode) {
        this.disconnectBluetooth();
        this.mux.invalidate();
        this.mode = mode;
        if (window.BreakawayBridge && mode !== 'peloton')
            window.BreakawayBridge.stopSensors();
        if (mode === 'demo') {
            this.mux.select('demo');
            this.emit('status', { state: 'demo', message: 'Demo power — not a physical bike' });
            return;
        }
        if (mode === 'peloton') {
            this.mux.select('peloton-v1');
            if (!window.BreakawayBridge) {
                this.emit('status', { state: 'unavailable', message: 'Install the Android shell for Peloton telemetry. A normal website cannot read the internal bike service.' });
                return;
            }
            window.BreakawayBridge.startSensors();
            this.emit('status', { state: 'probing', message: 'Probing bike interfaces; waiting for valid frames…' });
            return;
        }
        this.mux.select(mode);
        if (!navigator.bluetooth) {
            this.emit('status', { state: 'unavailable', message: 'Web Bluetooth is unavailable. Use desktop Chrome, the Android Peloton adapter, or another supported power source.' });
            return;
        }
        const service = mode === 'bluetooth-ftms' ? 0x1826 : 0x1818, characteristic = mode === 'bluetooth-ftms' ? 0x2ad2 : 0x2a63;
        try {
            this.bluetooth = await navigator.bluetooth.requestDevice({ filters: [{ services: [service] }] });
            this.bluetooth.addEventListener('gattserverdisconnected', () => { this.mux.invalidate(mode); this.emit('status', { state: 'disconnected', message: 'Bluetooth disconnected. Select the source again to reconnect.' }); });
            const server = await this.bluetooth.gatt.connect(), svc = await server.getPrimaryService(service);
            this.characteristic = await svc.getCharacteristic(characteristic);
            this.valueListener = e => { try {
                const sample = mode === 'bluetooth-ftms' ? decodeIndoorBike(e.target.value) : decodeCyclingPower(e.target.value, this.crank, performance.now());
                this.crank = sample.crank || null;
                this.mux.push(sample);
                this.emit('status', { state: 'live', message: mode });
            }
            catch (error) {
                this.emit('status', { state: 'invalid', message: error.message });
            } };
            this.characteristic.addEventListener('characteristicvaluechanged', this.valueListener);
            await this.characteristic.startNotifications();
            this.emit('status', { state: 'probing', message: 'Bluetooth connected; waiting for measurements…' });
        }
        catch (e) {
            this.mux.invalidate(mode);
            this.emit('status', { state: 'unavailable', message: e.message });
        }
    }
    setDemo(watts) { this.demoWatts = Math.max(0, Math.min(600, watts)); }
    read() { return this.mux.read(); }
    disconnectBluetooth() { if (this.characteristic && this.valueListener)
        this.characteristic.removeEventListener('characteristicvaluechanged', this.valueListener); if (this.bluetooth?.gatt?.connected)
        this.bluetooth.gatt.disconnect(); this.bluetooth = null; this.characteristic = null; this.crank = null; }
    diagnostics() { return { mode: this.mode, sample: this.read(), native: this.native, webBluetooth: !!navigator.bluetooth, secure: window.isSecureContext, userAgent: navigator.userAgent }; }
    destroy() { clearInterval(this.timer); this.disconnectBluetooth(); window.removeEventListener('breakaway-bike', this.nativeListener); }
}
