/*
 * Copyright (c) 2010-2026 Haifeng Li. All rights reserved.
 *
 * SMILE Serve is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SMILE Serve is distributed in the hope that it will be useful,
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with SMILE. If not, see <https://www.gnu.org/licenses/>.
 */
package smile.daemon;

import jakarta.inject.Inject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.websockets.next.OnClose;
import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.WebSocketConnection;
import io.quarkus.websockets.next.WebSocket;

/**
 * The interactive agent WebSocket (ADR-0002, ADR-0006). On open it starts a long-lived
 * {@link ChatSession}-style {@link RunSource} (the agent is built once and idles until
 * the first user message). The webview drives the conversation with inbound
 * {@code WebviewReply} frames:
 * <ul>
 *   <li>{@code user-message} → a free-text turn (starts or continues the chat)</li>
 *   <li>{@code answer} → resolves a clarify gate with the user's free text</li>
 *   <li>{@code approve}/{@code reject} → resolves an approval gate</li>
 *   <li>{@code cancel-run} → interrupts the in-flight turn</li>
 * </ul>
 *
 * <p>Endpoint: {@code ws://127.0.0.1:<port>/ws/run}. When a session token is configured
 * ({@code smile.daemon.token}), the connection's {@code token} query param must match.
 *
 * @author Haifeng Li
 */
@WebSocket(path = "/ws/run")
public class RunSocket {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(RunSocket.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Inject
    RunService runService;

    /** Per-connection control channel; user messages and gate replies route here. */
    private volatile RunControl control;
    /** Serializes outbound frames — emit() is called from the worker AND LLM threads. */
    private final Object sendLock = new Object();

    @OnOpen
    public void onOpen(WebSocketConnection connection) {
        if (!runService.authorize(null, queryToken(connection))) {
            LOG.warn("Rejected WebSocket connection: invalid session token");
            connection.closeAndAwait();
            return;
        }
        this.control = new RunControl();
        // Start the session worker; it emits session-started then idles for the first
        // user message (it does NOT auto-run a pre-configured prompt anymore).
        runService.start(msg -> sendJson(connection, msg), control);
    }

    @OnTextMessage
    public void onMessage(String text) {
        try {
            var node = MAPPER.readTree(text);
            String type = node.path("type").asText("");
            if (control == null) return;
            switch (type) {
                case "user-message" -> control.submitUserMessage(node.path("text").asText(""));
                case "answer" -> control.resolveGate(node.path("gateId").asText(null), node.path("answer").asText(""));
                case "approve", "reject" -> control.resolveGate(node.path("gateId").asText(null), "");
                case "cancel-run" -> control.cancel();
                default -> LOG.debugf("Ignoring webview reply of type '%s'", type);
            }
        } catch (Exception e) {
            LOG.warnf("Failed to parse webview reply: %s", e.getMessage());
        }
    }

    @OnClose
    public void onClose() {
        if (control != null) control.close();
    }

    private static String queryToken(WebSocketConnection connection) {
        // Extract ?token=... from the handshake query (ADR-0002 session token).
        try {
            String q = connection.handshakeRequest().query();
            if (q == null) return null;
            for (String pair : q.split("&")) {
                int i = pair.indexOf('=');
                if (i > 0 && pair.substring(0, i).equals("token")) {
                    return java.net.URLDecoder.decode(pair.substring(i + 1), java.nio.charset.StandardCharsets.UTF_8);
                }
            }
        } catch (Exception e) {
            LOG.debugf("No handshake query available: %s", e.getMessage());
        }
        return null;
    }

    private void sendJson(WebSocketConnection connection, DaemonMessage msg) {
        try {
            String json = MAPPER.writeValueAsString(msg);
            // sendTextAndAwait from multiple threads on one connection must be serialized.
            synchronized (sendLock) {
                connection.sendTextAndAwait(json);
            }
        } catch (Exception e) {
            LOG.warnf("Failed to send daemon message: %s", e.getMessage());
        }
    }
}
