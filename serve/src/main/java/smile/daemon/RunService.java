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
import jakarta.enterprise.context.ApplicationScoped;

/**
 * Supplies the {@link RunSource} that drives AutoML Runs. This is the single binding
 * point to switch from the bundled {@link ScriptedRunSource} to an agent-backed source
 * once the {@code ioa-agent} jar and LLM credentials are available (ADR-0005). No other
 * class — neither the transport nor the frontend — changes when the engine is swapped.
 *
 * @author Haifeng Li
 */
@ApplicationScoped
public class RunService {
    /** Emission pacing for the scripted source, in milliseconds. */
    private static final long STEP_MILLIS = 300;

    /**
     * Starts a run on a worker thread, delivering messages to {@code emit} and reading
     * gate/cancel signals from {@code control}.
     *
     * @param emit    sink for outbound {@link DaemonMessage}s.
     * @param control control channel for the run.
     */
    public void start(Consumer<DaemonMessage> emit, RunControl control) {
        RunSource source = newRunSource();
        Thread worker = new Thread(() -> source.run(emit, control), "automl-run");
        worker.setDaemon(true);
        worker.start();
    }

    /**
     * Creates the active {@link RunSource}. Override/replace this to bind the
     * agent-backed source (the {@code automl} skill stream).
     */
    protected RunSource newRunSource() {
        return new ScriptedRunSource(STEP_MILLIS);
    }
}
