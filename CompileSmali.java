import brut.androlib.ApkBuilder;
import brut.androlib.Config;
import java.io.File;

public class CompileSmali {
    public static void main(String[] args) throws Exception {
        String smaliFolder = (args.length > 0) ? args[0] : "smali_classes4";
        String dexName = (args.length > 1) ? args[1] : "classes4.dex";

        Config config = new Config("3.0.3");
        File root = new File("C:/Users/Administrator/Desktop/LARK/work/decoded");
        ApkBuilder builder = new ApkBuilder(root, config);
        builder.mSmaliBuilder = new brut.androlib.smali.SmaliBuilder(25);
        File outDir = new File("C:/Users/Administrator/Desktop/LARK/dex_out");
        outDir.mkdirs();
        builder.buildSourcesSmali(outDir, smaliFolder, dexName);
        System.out.println("DEX build success for " + dexName + "!");
    }
}
