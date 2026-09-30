#!/usr/bin/env python3
"""Compile and execute the pure-Java sensor mapping. This does NOT compile Android APIs."""
import pathlib, subprocess, tempfile, json
ROOT=pathlib.Path(__file__).resolve().parents[1]
source=ROOT/'android/app/src/main/java/com/breakaway/race/BikeSample.java'
harness='''import com.breakaway.race.BikeSample;
public class SensorMappingCheck {
 public static void main(String[] args) {
  BikeSample a=BikeSample.fromHeader(85,24550,43);
  if(a.watts!=245.5||a.cadence!=85||a.resistance!=43)throw new AssertionError("scaling");
  if(BikeSample.fromHeader(0,0,0).watts!=0)throw new AssertionError("idle");
  int rejected=0;long[][] cases={{-1,100,10},{241,100,10},{80,-1,20},{80,250001,30},{80,100,101}};
  for(long[] c:cases)try{BikeSample.fromHeader(c[0],c[1],(int)c[2]);}catch(IllegalArgumentException e){rejected++;}
  if(rejected!=5)throw new AssertionError("range guards");
  for(int rpm=0;rpm<=240;rpm++)for(int res=0;res<=100;res++)if(BikeSample.fromHeader(rpm,20000,res).watts!=200)throw new AssertionError("mapping invariant");
  System.out.println("Pure Java mapping: 7 named checks and 24,341 valid combinations passed. No Android APIs were tested.");
 }
}'''
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'SensorMappingCheck.java';p.write_text(harness)
 subprocess.run(['javac','--release','17','-d',directory,str(source),str(p)],check=True)
 result=subprocess.run(['java','-cp',directory,'SensorMappingCheck'],check=True,capture_output=True,text=True)
 print(result.stdout.strip())
 (ROOT/'artifacts/java-mapping.txt').write_text(result.stdout)

# Parse every Java source using the real JDK parser, without pretending to have
# an Android classpath. Parsing cannot catch unresolved methods or API mismatch.
parser = r'''import javax.tools.*;
import com.sun.source.util.JavacTask;
import java.util.*;
public class JavaSyntaxCheck {
 public static void main(String[] paths) throws Exception {
  JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
  DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
  try(StandardJavaFileManager manager=compiler.getStandardFileManager(diagnostics,null,null)) {
   var units=manager.getJavaFileObjectsFromStrings(Arrays.asList(paths));
   JavacTask task=(JavacTask)compiler.getTask(null,manager,diagnostics,List.of("--release","17","-proc:none"),null,units);
   for(var ignored:task.parse()) {}
   long errors=diagnostics.getDiagnostics().stream().filter(d->d.getKind()==Diagnostic.Kind.ERROR).count();
   if(errors>0){diagnostics.getDiagnostics().forEach(System.err::println);throw new AssertionError("Java syntax errors: "+errors);}
   System.out.println("Parsed "+paths.length+" Java sources with the JDK compiler parser. Syntax only; Android API/dependency resolution and APK compilation were NOT tested.");
  }
 }
}'''
java_sources=sorted((ROOT/'android/app/src').rglob('*.java'))
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'JavaSyntaxCheck.java';p.write_text(parser)
 subprocess.run(['javac','--release','17','-d',directory,str(p)],check=True)
 result=subprocess.run(['java','-cp',directory,'JavaSyntaxCheck',*[str(p) for p in java_sources]],check=True,capture_output=True,text=True)
 print(result.stdout.strip())
 (ROOT/'artifacts/java-syntax.txt').write_text(result.stdout)
