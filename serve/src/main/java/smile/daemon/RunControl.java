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

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

/**
 * The control channel between the webview and a {@link ChatSession} / {@link RunSource}.
 * Carries three kinds of signal:
 * <ul>
 *   <li><b>User messages</b> — free-text turns the user sends; the session's turn loop
 *       blocks on {@link #takeUserMessage} between turns.</li>
 *   <li><b>Gate answers</b> — resolutions of a clarify/approval gate, optionally carrying
 *       the user's free-text answer; the agent thread blocks on {@link #awaitGate}.</li>
 *   <li><b>Cancellation</b> — interrupts the in-flight turn.</li>
 * </ul>
 *
 * @author Haifeng Li
 */
public final class RunControl {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition signal = lock.newCondition();
    /** gateId -> the user's answer (empty string = bare approve). */
    private final Map<String, String> gateAnswers = new ConcurrentHashMap<>();
    /** Inbound user messages awaiting the turn loop. */
    private final LinkedBlockingQueue<String> userMessages = new LinkedBlockingQueue<>();
    private volatile boolean cancelled = false;
    private volatile boolean closed = false;

    // ---- User messages (turn loop) ----

    /** Enqueue a free-text user turn from the webview. */
    public void submitUserMessage(String text) {
        if (text != null) userMessages.offer(text);
    }

    /**
     * Block until the next user message arrives, the session is cancelled, or closed.
     * @return the message, or empty if the session ended while waiting.
     */
    public Optional<String> takeUserMessage() {
        while (!closed) {
            try {
                String msg = userMessages.poll(200, TimeUnit.MILLISECONDS);
                if (msg != null) return Optional.of(msg);
                if (cancelled) {
                    // Drain a pending cancel between turns; keep waiting for the next message.
                    cancelled = false;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    // ---- Gate resolution ----

    /** Resolve a gate with an optional free-text answer; wakes the waiting agent thread. */
    public void resolveGate(String gateId, String answer) {
        gateAnswers.put(gateId, answer == null ? "" : answer);
        lock.lock();
        try {
            signal.signalAll();
        } finally {
            lock.unlock();
        }
    }

    /**
     * Block until the given gate is resolved or the turn is cancelled.
     * @return the user's answer if resolved, or empty if cancelled.
     */
    public Optional<String> awaitGate(String gateId) {
        lock.lock();
        try {
            while (!gateAnswers.containsKey(gateId) && !cancelled && !closed) {
                signal.await(200, TimeUnit.MILLISECONDS);
            }
            return Optional.ofNullable(gateAnswers.get(gateId));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } finally {
            lock.unlock();
        }
    }

    // ---- Cancellation / lifecycle ----

    /** Request cancellation of the in-flight turn. */
    public void cancel() {
        cancelled = true;
        wake();
    }

    public boolean isCancelled() {
        return cancelled;
    }

    /** Clear the cancel flag after a turn handles it. */
    public void clearCancel() {
        cancelled = false;
    }

    /** Permanently end the session (connection closed); unblocks all waiters. */
    public void close() {
        closed = true;
        wake();
    }

    public boolean isClosed() {
        return closed;
    }

    private void wake() {
        lock.lock();
        try {
            signal.signalAll();
        } finally {
            lock.unlock();
        }
    }
}
