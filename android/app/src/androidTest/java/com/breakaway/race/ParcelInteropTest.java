package com.breakaway.race;
import android.os.Parcel;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/** Synthetic wire fixture: does not represent a physical bike certification. */
@RunWith(AndroidJUnit4.class)
public class ParcelInteropTest {
    @Test public void decodesFixedHeaderAndIgnoresUnknownTail(){Parcel p=Parcel.obtain();try{p.writeInt(1);p.writeLong(88);p.writeLong(21234);p.writeLong(1000);p.writeLong(500);p.writeInt(42);p.writeInt(44);p.writeString("future-tail");p.setDataPosition(0);BikeSample sample=BikeSensors.decodeHeader(p);assertEquals(212.34,sample.watts,0.001);assertEquals(88,sample.cadence,0.001);assertEquals(42,sample.resistance);}finally{p.recycle();}}
    @Test(expected=IllegalArgumentException.class) public void rejectsNull(){Parcel p=Parcel.obtain();try{p.writeInt(0);p.setDataPosition(0);BikeSensors.decodeHeader(p);}finally{p.recycle();}}
    @Test(expected=IllegalArgumentException.class) public void rejectsTruncated(){Parcel p=Parcel.obtain();try{p.writeInt(1);p.writeLong(88);p.setDataPosition(0);BikeSensors.decodeHeader(p);}finally{p.recycle();}}
}
