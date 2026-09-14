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
  FormOpRequestPayload,
  FormOpResponsePayload,
  HostPlatform,
  InitPayload,
  NativeToWebType,
} from './protocol';

export interface MockNativeHostOptions {
  auth: AuthPayload;
  configure?: ConfigurePayload;
  sdkVersion?: string;
  /**
   * Which host the mock impersonates, in `init.platform` AND in the transport hook it installs
   * (default 'android'). The portal keys per-OS styling and templates off this, so a harness
   * that can only be Android cannot exercise the iOS path at all.
   */
  platform?: HostPlatform;
  /** Auto-reply to `hello` with `init` (default true). */
  autoInit?: boolean;
  /**
   * Form delegation (SPEC §4.1): when set, `init` declares
   * `formDelegation: true` and every `formOp` from the web is answered by
   * this handler (resolve = `{ok:true, body}`, reject = `{ok:false, error}`).
   */
  onFormOp?: (request: FormOpRequestPayload) => Promise<unknown>;
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
        platform: this.options.platform ?? 'android',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        configure: this.options.configure ?? {},
        auth: this.options.auth,
        formDelegation: !!this.options.onFormOp,
      };
      this.send('init', payload, envelope.id);
    }

    if (envelope.type === 'formOp') {
      const handler = this.options.onFormOp;
      if (!handler) {
        this.send(
          'ack',
          { ok: false, error: 'mock host: no onFormOp handler configured' } satisfies FormOpResponsePayload,
          envelope.id
        );
        return;
      }
      handler(envelope.payload as FormOpRequestPayload)
        .then((body) =>
          this.send('ack', { ok: true, body } satisfies FormOpResponsePayload, envelope.id)
        )
        .catch((error: unknown) =>
          this.send(
            'ack',
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              status: typeof (error as { status?: unknown })?.status === 'number'
                ? (error as { status: number }).status
                : undefined,
            } satisfies FormOpResponsePayload,
            envelope.id
          )
        );
    }
  }
}

/**
 * Installs the mock behind the transport hook of `options.platform` (default Android). Must run
 * before createWebBridge() is first called (i.e. before Angular bootstraps), because the bridge
 * detects its transport once.
 */
export function installMockNativeHost(options: MockNativeHostOptions): MockNativeHost {
  const host = new MockNativeHost(options);
  const post = (json: string) => host._receiveFromWeb(json);
  const w = window as any;

  switch (options.platform) {
    case 'ios':
      w.webkit = { ...(w.webkit ?? {}), messageHandlers: { ...(w.webkit?.messageHandlers ?? {}), amthal: { postMessage: post } } };
      break;
    case 'react-native':
      w.__AMTHAL_EMBEDDED_RN__ = true;
      w.ReactNativeWebView = { postMessage: post };
      break;
    default:
      w.__amthalAndroid = { postMessage: post };
  }
  return host;
}
