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

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Control signals flowing from the webview back to a running {@link RunSource}:
 * gate resolutions (approve/answer) and cancellation. The {@link RunSource} calls
 * {@link #awaitGate} after opening a gate to block until the human responds —
 * mirroring the cooperative human-in-the-loop the {@code automl} skill already
 * implements via its "ask once" {@code onQuestion} callback (ADR-0010).
 *
 * @author Haifeng Li
 */
public final class RunControl {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition signal = lock.newCondition();
    private final Set<String> resolvedGates = ConcurrentHashMap.newKeySet();
    private volatile boolean cancelled = false;

    /** Marks a gate resolved and wakes any thread waiting on it. */
    public void resolveGate(String gateId) {
        resolvedGates.add(gateId);
        lock.lock();
        try {
            signal.signalAll();
        } finally {
            lock.unlock();
        }
    }

    /** Requests cancellation of the run and wakes any waiting thread. */
    public void cancel() {
        cancelled = true;
        lock.lock();
        try {
            signal.signalAll();
        } finally {
            lock.unlock();
        }
    }

    /** Whether cancellation has been requested. */
    public boolean isCancelled() {
        return cancelled;
    }

    /**
     * Blocks until the given gate is resolved or the run is cancelled.
     *
     * @param gateId the open gate to wait on.
     * @return {@code true} if the gate was resolved, {@code false} if cancelled.
     */
    public boolean awaitGate(String gateId) {
        lock.lock();
        try {
            while (!resolvedGates.contains(gateId) && !cancelled) {
                // Wake periodically as a guard against missed signals.
                signal.await(200, TimeUnit.MILLISECONDS);
            }
            return resolvedGates.contains(gateId);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            lock.unlock();
        }
    }
}
