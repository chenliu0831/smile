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

import java.util.function.Consumer;

/**
 * Produces the {@link DaemonMessage} stream for one AutoML Run.
 *
 * <p>This is the seam between the transport (the WebSocket endpoint) and the engine
 * that actually drives a run. Per ADR-0005, the real engine is Clair's {@code automl}
 * agent skill in the {@code ioa-agent} jar: a {@code ScriptedRunSource}-shaped adapter
 * would subscribe to {@code ioa.agent.Agent.stream(...)} and translate the agent's
 * token/tool-call/onQuestion callbacks into {@link DaemonMessage}s here.
 *
 * <p>That jar is not present in this repository (it ships only in the released
 * distribution) and a live run additionally requires LLM credentials, so the bundled
 * implementation is {@link ScriptedRunSource}, which replays a representative run over
 * the identical contract. Swapping in the agent-backed source is a localized change:
 * implement this interface and bind it in {@link RunService}.
 *
 * @author Haifeng Li
 */
public interface RunSource {
    /**
     * Drives a single run, emitting messages in order via {@code emit}. The call
     * blocks on the worker thread until the run finishes or {@code control} signals
     * a stop. Gate handling is cooperative: when the source emits a
     * {@link DaemonMessage.GateOpened}, it waits on {@code control} until the matching
     * gate is resolved (see {@link RunControl}).
     *
     * @param emit    sink for outbound messages.
     * @param control gate/cancel signals coming back from the webview.
     */
    void run(Consumer<DaemonMessage> emit, RunControl control);
}
