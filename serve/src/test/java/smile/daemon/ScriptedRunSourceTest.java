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

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies the scripted run emits a well-formed protocol stream and blocks at the
 * Clarify gate until it is resolved.
 *
 * @author Haifeng Li
 */
public class ScriptedRunSourceTest {

    @Test
    public void blocksAtGateThenCompletesWhenResolved() throws Exception {
        // Given a scripted source with no pacing and a control channel.
        var source = new ScriptedRunSource(0);
        var control = new RunControl();
        var messages = new CopyOnWriteArrayList<DaemonMessage>();

        // When the run starts on a worker thread.
        Thread worker = new Thread(() -> source.run(messages::add, control));
        worker.start();

        // Then it emits up to the gate and waits (no run-finished yet).
        waitUntil(() -> messages.stream().anyMatch(m -> m instanceof DaemonMessage.GateOpened), 2000);
        Thread.sleep(50);
        assertTrue(messages.stream().anyMatch(m -> m instanceof DaemonMessage.RunStarted));
        assertTrue(messages.stream().anyMatch(m -> m instanceof DaemonMessage.GateOpened));
        assertFalse(messages.stream().anyMatch(m -> m instanceof DaemonMessage.RunFinished),
                "must not finish before the gate is resolved");

        // When the gate is resolved.
        control.resolveGate("g-metric", "AUC");
        worker.join(3000);

        // Then the run completes and the gate was closed.
        assertTrue(messages.stream().anyMatch(m -> m instanceof DaemonMessage.GateClosed));
        var last = messages.get(messages.size() - 1);
        assertInstanceOf(DaemonMessage.RunFinished.class, last);
        assertEquals("completed", ((DaemonMessage.RunFinished) last).status());

        // And a leaderboard artifact was emitted.
        assertTrue(messages.stream().anyMatch(m ->
                m instanceof DaemonMessage.ArtifactMsg a && "leaderboard".equals(a.artifact().kind())));
    }

    @Test
    public void cancellationAtGateEndsTheRun() throws Exception {
        var source = new ScriptedRunSource(0);
        var control = new RunControl();
        var messages = new CopyOnWriteArrayList<DaemonMessage>();
        Thread worker = new Thread(() -> source.run(messages::add, control));
        worker.start();

        waitUntil(() -> messages.stream().anyMatch(m -> m instanceof DaemonMessage.GateOpened), 2000);
        control.cancel();
        worker.join(3000);

        var last = messages.get(messages.size() - 1);
        assertInstanceOf(DaemonMessage.RunFinished.class, last);
        assertEquals("cancelled", ((DaemonMessage.RunFinished) last).status());
    }

    private interface Cond { boolean ok(); }

    private void waitUntil(Cond cond, long timeoutMs) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (System.nanoTime() < deadline) {
            if (cond.ok()) return;
            Thread.sleep(10);
        }
        fail("condition not met within " + timeoutMs + "ms");
    }
}
