/**
 * MockNativeHost — simulates a native Amthal host SDK inside a plain browser.
 *
 * Used for:
 *  - developing/QA-ing the portal's embed mode in a desktop browser
 *  - Playwright/Karma tests of PlatformBridgeService
 *  - the bridge conformance harness (scripted message sequences)
 *
 * Install it BEFORE the Angular app boots (e.g. from main.ts when
 * `?mockEmbed=1` is present, or in a test's beforeEach):
 *
 *   const host = installMockNativeHost({ auth: { token: 'dev-token' } });
 *   host.outbound$  // every message the web sent to the "native" side
 */

import {
  AuthPayload,
  BRIDGE_PROTOCOL_VERSION,
  BridgeEnvelope,
  ConfigurePayload,
  InitPayload,
  NativeToWebType,
} from './protocol';

export interface MockNativeHostOptions {
  auth: AuthPayload;
  configure?: ConfigurePayload;
  sdkVersion?: string;
  /** Auto-reply to `hello` with `init` (default true). */
  autoInit?: boolean;
}

export class MockNativeHost {
  readonly outbound: BridgeEnvelope[] = [];
  private listeners = new Set<(e: BridgeEnvelope) => void>();
  private counter = 0;

  constructor(private options: MockNativeHostOptions) {}

  /** Simulate a native->web message. */
  send(type: NativeToWebType, payload?: unknown, replyTo?: string): string {
    const envelope: BridgeEnvelope = {
      v: BRIDGE_PROTOCOL_VERSION,
      id: `n-mock-${++this.counter}`,
      type,
      payload,
    };
    if (replyTo) envelope.replyTo = replyTo;
    // Mirrors the native embedding contract: JSON string via __amthalReceive.
    window.__amthalReceive?.(JSON.stringify(envelope));
    return envelope.id;
  }

  /** Register a spy on web->native messages. Returns unsubscribe. */
  onOutbound(fn: (e: BridgeEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Wait for the next web->native message of a given type. */
  waitFor(type: string, timeoutMs = 5000): Promise<BridgeEnvelope> {
    const existing = this.outbound.find((e) => e.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`mock host: timed out waiting for '${type}'`));
      }, timeoutMs);
      const off = this.onOutbound((e) => {
        if (e.type === type) {
          clearTimeout(timer);
          off();
          resolve(e);
        }
      });
    });
  }

  /** @internal called by the installed transport hook */
  _receiveFromWeb(json: string): void {
    let envelope: BridgeEnvelope;
    try {
      envelope = JSON.parse(json) as BridgeEnvelope;
    } catch {
      return;
    }
    this.outbound.push(envelope);
    this.listeners.forEach((fn) => fn(envelope));

    if (envelope.type === 'hello' && (this.options.autoInit ?? true)) {
      const payload: InitPayload = {
        sdkVersion: this.options.sdkVersion ?? 'mock-0.0.0',
        platform: 'android',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        configure: this.options.configure ?? {},
        auth: this.options.auth,
      };
      this.send('init', payload, envelope.id);
    }
  }
}

/**
 * Installs the mock as if it were the Android transport. Must run before
 * createWebBridge() is first called (i.e. before Angular bootstraps).
 */
export function installMockNativeHost(options: MockNativeHostOptions): MockNativeHost {
  const host = new MockNativeHost(options);
  window.__amthalAndroid = { postMessage: (json: string) => host._receiveFromWeb(json) };
  return host;
}
