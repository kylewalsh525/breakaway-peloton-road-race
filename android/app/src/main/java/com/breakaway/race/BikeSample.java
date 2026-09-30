package com.breakaway.race;

/** Pure-Java, unit-testable interpretation of the documented fixed BikeData header. */
public final class BikeSample {
    public final double watts;
    public final int cadence;
    public final int resistance;
    private BikeSample(double watts, int cadence, int resistance) {
        this.watts = watts; this.cadence = cadence; this.resistance = resistance;
    }
    public static BikeSample fromHeader(long rpm, long centiwatts, int resistance) {
        if (rpm < 0 || rpm > 240 || centiwatts < 0 || centiwatts > 250000 || resistance < 0 || resistance > 100) {
            throw new IllegalArgumentException("Unsupported or invalid BikeData header; no measurement emitted");
        }
        return new BikeSample(centiwatts / 100.0, (int) rpm, resistance);
    }
}
