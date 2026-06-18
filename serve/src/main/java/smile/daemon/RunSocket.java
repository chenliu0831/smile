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
import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.WebSocketConnection;
import io.quarkus.websockets.next.WebSocket;

/**
 * The AutoML Run WebSocket (ADR-0002): the high-throughput stream the Webview
 * connects to directly over loopback. On open it starts a run and forwards each
 * {@link DaemonMessage} as a JSON text frame (shapes identical to
 * {@code studio/app/src/daemon/protocol.ts}). Inbound frames are
 * {@code WebviewReply}s — gate answers/approvals and cancellation.
 *
 * <p>Endpoint: {@code ws://127.0.0.1:<port>/ws/run}.
 *
 * @author Haifeng Li
 */
@WebSocket(path = "/ws/run")
public class RunSocket {
    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(RunSocket.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Inject
    RunService runService;

    /** Per-connection control channel; gate replies resolve against it. */
    private volatile RunControl control;

    @OnOpen
    public void onOpen(WebSocketConnection connection) {
        this.control = new RunControl();
        runService.start(msg -> sendJson(connection, msg), control);
    }

    @OnTextMessage
    public void onMessage(String text) {
        // Inbound WebviewReply: { type: "approve"|"answer"|"reject"|"cancel-run", ... }
        try {
            var node = MAPPER.readTree(text);
            String type = node.path("type").asText("");
            switch (type) {
                case "approve", "answer", "reject" -> {
                    String gateId = node.path("gateId").asText(null);
                    if (gateId != null && control != null) control.resolveGate(gateId);
                }
                case "cancel-run" -> {
                    if (control != null) control.cancel();
                }
                default -> LOG.debugf("Ignoring webview reply of type '%s'", type);
            }
        } catch (Exception e) {
            LOG.warnf("Failed to parse webview reply: %s", e.getMessage());
        }
    }

    private void sendJson(WebSocketConnection connection, DaemonMessage msg) {
        try {
            connection.sendTextAndAwait(MAPPER.writeValueAsString(msg));
        } catch (Exception e) {
            LOG.warnf("Failed to send daemon message: %s", e.getMessage());
        }
    }
}
