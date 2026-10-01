package forge.harness.host;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;

final class DecisionJournal {
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ENTRIES = 4096;
    private String startRequest;
    private JsonArray entries = new JsonArray();
    private long nextSequence = 1;
    private int bytes;
    private String unavailableReason;
    private boolean failurePending;

    DecisionJournal(final String startRequest) {
        this.startRequest = startRequest;
        bytes = startRequest.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > MAX_BYTES) {
            invalidate("start request exceeds journal limit");
        }
    }

    synchronized void record(final int playerIndex, final String prompt, final JsonObject action) {
        if (unavailableReason != null) {
            return;
        }
        final JsonObject entry = new JsonObject();
        entry.addProperty("sequence", nextSequence);
        entry.addProperty("playerIndex", playerIndex);
        entry.add("prompt", prompt == null ? null : JsonParser.parseString(prompt));
        entry.add("action", action.deepCopy());
        final int size = entry.toString().getBytes(StandardCharsets.UTF_8).length;
        if (entries.size() >= MAX_ENTRIES || size > MAX_BYTES - bytes) {
            invalidate("undrained decisions exceed journal limit");
            return;
        }
        entries.add(entry);
        bytes += size;
        nextSequence++;
    }

    synchronized void invalidate(final String reason) {
        if (unavailableReason != null) {
            return;
        }
        unavailableReason = reason;
        failurePending = true;
        startRequest = null;
        entries = new JsonArray();
        bytes = 0;
    }

    synchronized String drain() {
        if (startRequest == null && entries.isEmpty() && !failurePending) {
            return "";
        }
        final JsonObject batch = new JsonObject();
        batch.addProperty("version", 1);
        batch.addProperty("nextSequence", nextSequence);
        if (startRequest != null) {
            batch.addProperty("startRequest", startRequest);
        }
        if (unavailableReason != null) {
            batch.addProperty("unavailableReason", unavailableReason);
        }
        batch.add("entries", entries);
        final String result = batch.toString();
        startRequest = null;
        entries = new JsonArray();
        bytes = 0;
        failurePending = false;
        return result;
    }
}
