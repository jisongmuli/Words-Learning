package com.jisongmuli.wordslearning;

import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** App-private JSON with atomic replacement and an explicit pre-import recovery copy. */
final class StudyStorage {
    private final File directory;
    private final AtomicFile state;
    StudyStorage(File directory) {
        this.directory = directory;
        this.state = new AtomicFile(new File(directory,"state.json"));
    }
    synchronized String read() throws IOException {
        if (!state.getBaseFile().exists() && !new File(directory,"state.json.bak").exists()) return null;
        return new String(state.readFully(), StandardCharsets.UTF_8);
    }
    synchronized void write(String json, boolean importing) throws Exception {
        if (json.length() > 8*1024*1024) throw new IOException("学习数据超过存储上限，请先导出备份。");
        JSONObject candidate = new JSONObject(json);
        if (candidate.optInt("schemaVersion") != 1 || !candidate.has("unknown") || !candidate.has("progress")) throw new IOException("学习数据格式不正确。");
        String old = read();
        if (old != null) atomicWrite(new AtomicFile(new File(directory, importing ? "state.before-import.json" : "state.previous.json")),old);
        atomicWrite(state,json);
    }
    private static void atomicWrite(AtomicFile target, String value) throws IOException {
        FileOutputStream out = null;
        try {
            out = target.startWrite();
            out.write(value.getBytes(StandardCharsets.UTF_8));
            target.finishWrite(out);
        } catch (IOException error) { if (out != null) target.failWrite(out); throw error; }
    }
}
