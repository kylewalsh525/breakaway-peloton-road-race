package com.breakaway.race;
import org.junit.Test;
import static org.junit.Assert.*;
public class BikeSampleTest {
    @Test public void mapsCentiwatts(){BikeSample s=BikeSample.fromHeader(85,24550,43);assertEquals(245.5,s.watts,0.0001);assertEquals(85,s.cadence,0.001);assertEquals(43,s.resistance);}
    @Test public void idleIsValid(){assertEquals(0,BikeSample.fromHeader(0,0,0).watts,0.0);}
    @Test(expected=IllegalArgumentException.class) public void rejectsNegativePower(){BikeSample.fromHeader(80,-100,40);}
    @Test(expected=IllegalArgumentException.class) public void rejectsWrongOffsets(){BikeSample.fromHeader(500000,80000,20);}
    @Test(expected=IllegalArgumentException.class) public void rejectsResistanceOverflow(){BikeSample.fromHeader(80,80000,255);}
}
