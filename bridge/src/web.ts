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
    if ((!set || set.size === 0) && anyHandlers.size === 0) {
      preListenerBuffer.push(envelope);
      return;
    }
    set?.forEach((h) => h(envelope));
    anyHandlers.forEach((h) => h(envelope));
  }

  window.__amthalReceive = (raw: string) => {
    let envelope: BridgeEnvelope;
    try {
      envelope = JSON.parse(raw) as BridgeEnvelope;
    } catch {
      return; // malformed input from outside the protocol — ignore
    }
    if (!envelope || envelope.v !== BRIDGE_PROTOCOL_VERSION || typeof envelope.type !== 'string') return;
    dispatch(envelope);
  };

  function post(envelope: BridgeEnvelope): void {
    transport?.post(JSON.stringify(envelope));
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
      preListenerBuffer.splice(0).forEach((e) => handler(e));
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
