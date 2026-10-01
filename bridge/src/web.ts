/**
 * Web-side bridge shim — runs inside the portal (Angular app).
 *
 * Responsibilities:
 *  - detect whether the page is embedded by an Amthal host SDK (and which one)
 *  - normalize outbound transport (Android JS interface / WKWebView message
 *    handler / React Native WebView postMessage)
 *  - expose `window.__amthalReceive` for inbound messages, buffering anything
 *    that arrives before listeners attach
 *  - provide send / request(±ack) / reply / subscribe primitives with the
 *    normative timeouts from protocol.ts
 *
 * The portal's PlatformBridgeService wraps this in an Angular-friendly API.
 */

import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeEnvelope,
  MessageType,
  NativeToWebType,
  TIMINGS,
  WebToNativeType,
} from './protocol';

type OutboundTransport = (json: string) => void;

declare global {
  interface Window {
    __amthalReceive?: (raw: string) => void;
    __amthalAndroid?: { postMessage: (json: string) => void };
    __AMTHAL_EMBEDDED_RN__?: boolean;
    ReactNativeWebView?: { postMessage: (json: string) => void };
    webkit?: { messageHandlers?: { amthal?: { postMessage: (json: string) => void } } };
  }
}

function detectTransport(): { platformHint: string; post: OutboundTransport } | null {
  const w = window;
  if (w.__amthalAndroid?.postMessage) {
    return { platformHint: 'android', post: (j) => w.__amthalAndroid!.postMessage(j) };
  }
  if (w.webkit?.messageHandlers?.amthal) {
    return { platformHint: 'ios', post: (j) => w.webkit!.messageHandlers!.amthal!.postMessage(j) };
  }
  if (w.__AMTHAL_EMBEDDED_RN__ && w.ReactNativeWebView?.postMessage) {
    return { platformHint: 'react-native', post: (j) => w.ReactNativeWebView!.postMessage(j) };
  }
  return null;
}

export type MessageHandler = (envelope: BridgeEnvelope) => void;

export interface WebBridge {
  /** True when a native Amthal host is present. */
  readonly embedded: boolean;
  /** 'android' | 'ios' | 'react-native' — best-effort hint, '' when not embedded. */
  readonly platformHint: string;
  /** Fire-and-forget message to the host. Returns the envelope id. */
  send<T = unknown>(type: WebToNativeType, payload?: T, replyTo?: string): string;
  /** Send and await the correlated reply (usually an ack). */
  request<TReply = unknown>(
    type: WebToNativeType,
    payload?: unknown,
    timeoutMs?: number
  ): Promise<BridgeEnvelope<MessageType, TReply>>;
  /** Reply to a host request. */
  reply(toEnvelope: BridgeEnvelope, type: WebToNativeType, payload?: unknown): void;
  /** Subscribe to inbound host messages of one type. Returns unsubscribe. */
  on<T = unknown>(type: NativeToWebType, handler: (e: BridgeEnvelope<MessageType, T>) => void): () => void;
  /** Subscribe to every inbound message (diagnostics). Returns unsubscribe. */
  onAny(handler: MessageHandler): () => void;
}

/** Envelopes held for a not-yet-attached typed handler. Boot needs a handful, never more. */
const MAX_PRE_LISTENER_BUFFER = 64;

let warnedVersionMismatch = false;
let counter = 0;
function newId(): string {
  // uuid-ish without a crypto dependency; uniqueness only matters per session.
  counter += 1;
  return `w-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates (or returns the already-created) web bridge. Installs
 * window.__amthalReceive on first call. Safe to call in a plain browser —
 * `embedded` will simply be false and send/request become no-ops that reject.
 */
export function createWebBridge(): WebBridge {
  if (installed) return installed;

  const transport = detectTransport();
  const handlers = new Map<string, Set<MessageHandler>>();
  const anyHandlers = new Set<MessageHandler>();
  const pending = new Map<string, { resolve: (e: BridgeEnvelope) => void; timer: ReturnType<typeof setTimeout> }>();
  const preListenerBuffer: BridgeEnvelope[] = [];

  function dispatch(envelope: BridgeEnvelope): void {
    if (envelope.replyTo && pending.has(envelope.replyTo)) {
      const p = pending.get(envelope.replyTo)!;
      pending.delete(envelope.replyTo);
      clearTimeout(p.timer);
      p.resolve(envelope);
      return;
    }
    const set = handlers.get(envelope.type);
    // Diagnostics observers never affect delivery. Buffering keyed off `anyHandlers` as well
    // meant one `onAny` subscriber stopped an unhandled message being held — so an `init`
    // that landed before the typed listener attached reached the logger and nothing else,
    // and the portal waited out its handshake for a message it had already been sent.
    anyHandlers.forEach((h) => h(envelope));
    if (set && set.size > 0) {
      set.forEach((h) => h(envelope));
      return;
    }
    // A correlated reply whose request is gone — it timed out, or the host answered twice.
    // Nothing subscribes to 'ack' by type, so buffering these grew the queue for the life of
    // the session, and a `formOp` reply can carry an entire form schema.
    if (envelope.replyTo) {
      return;
    }
    // The buffer exists to cover the gap before listeners attach, not to be a queue. If it is
    // still filling long after boot, something is sending a type nobody handles — drop the
    // oldest rather than grow without bound.
    if (preListenerBuffer.length >= MAX_PRE_LISTENER_BUFFER) {
      preListenerBuffer.shift();
    }
    preListenerBuffer.push(envelope);
  }

  window.__amthalReceive = (raw: string) => {
    let envelope: BridgeEnvelope;
    try {
      envelope = JSON.parse(raw) as BridgeEnvelope;
    } catch {
      return; // malformed input from outside the protocol — ignore
    }
    if (!envelope || typeof envelope.type !== 'string') return;
    if (envelope.v !== BRIDGE_PROTOCOL_VERSION) {
      // Dropping these silently makes a host one version ahead indistinguishable from a host
      // that never connected — the same blank screen, no clue which. Say it once.
      if (!warnedVersionMismatch) {
        warnedVersionMismatch = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[amthal-bridge] ignoring host message '${envelope.type}': protocol v${envelope.v} ` +
            `≠ v${BRIDGE_PROTOCOL_VERSION} supported here. Update the host SDK or the portal.`
        );
      }
      return;
    }
    dispatch(envelope);
  };

  let warnedNoTransport = false;
  function post(envelope: BridgeEnvelope): void {
    if (!transport) {
      // `send` still returns an id, so without this a message to a host that is not there is
      // indistinguishable from one that was delivered.
      if (!warnedNoTransport) {
        warnedNoTransport = true;
        // eslint-disable-next-line no-console
        console.warn(`[amthal-bridge] '${envelope.type}' dropped: no native host attached.`);
      }
      return;
    }
    transport.post(JSON.stringify(envelope));
  }

  const bridge: WebBridge = {
    embedded: transport != null,
    platformHint: transport?.platformHint ?? '',

    send(type, payload, replyTo) {
      const envelope: BridgeEnvelope = { v: BRIDGE_PROTOCOL_VERSION, id: newId(), type, payload };
      if (replyTo) envelope.replyTo = replyTo;
      post(envelope);
      return envelope.id;
    },

    request(type, payload, timeoutMs = TIMINGS.requestTimeoutMs) {
      return new Promise((resolve, reject) => {
        if (!transport) {
          reject(new Error('not embedded'));
          return;
        }
        const envelope: BridgeEnvelope = { v: BRIDGE_PROTOCOL_VERSION, id: newId(), type, payload };
        const timer = setTimeout(() => {
          pending.delete(envelope.id);
          reject(new Error(`bridge request '${type}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(envelope.id, { resolve: resolve as (e: BridgeEnvelope) => void, timer });
        post(envelope);
      });
    },

    reply(toEnvelope, type, payload) {
      bridge.send(type, payload, toEnvelope.id);
    },

    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as MessageHandler);
      // flush buffered messages of this type, preserving order
      for (let i = 0; i < preListenerBuffer.length; ) {
        if (preListenerBuffer[i].type === type) {
          const [e] = preListenerBuffer.splice(i, 1);
          (handler as MessageHandler)(e);
        } else {
          i++;
        }
      }
      return () => set!.delete(handler as MessageHandler);
    },

    onAny(handler) {
      anyHandlers.add(handler);
      // A COPY: these are still waiting for their typed handler, and draining the buffer here
      // would silently consume them.
      preListenerBuffer.slice().forEach((e) => handler(e));
      return () => anyHandlers.delete(handler);
    },
  };

  installed = bridge;
  return bridge;
}

let installed: WebBridge | null = null;

/** Test hook: reset the singleton (used by unit tests only). */
export function __resetWebBridgeForTests(): void {
  installed = null;
  delete window.__amthalReceive;
}
