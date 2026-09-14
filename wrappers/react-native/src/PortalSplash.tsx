import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';

/** When the wait is worth explaining rather than just absorbing. */
const SLOW_AFTER_MS = 8_000;
/** Width of the indeterminate track, in points. The sweep is expressed against it. */
const TRACK_W = 104;

/** Concentric stand-in for a radial gradient — see the render for why. Outermost first. */
const WASH_LAYERS = [
  { size: 1100, opacity: 0.022 },
  { size: 820, opacity: 0.022 },
  { size: 600, opacity: 0.024 },
  { size: 400, opacity: 0.026 },
];

export interface PortalSplashProps {
  /** Tenant brand colour. Omit for a deliberately plain, unbranded wait. */
  brandColor?: ColorValue;
  /**
   * Your own logo, already laid out (an `<Image>`, an SVG component — whatever you use).
   *
   * The SDK never fetches or guesses one: a host app HAS its logo as a local asset, while the
   * portal's is a nullable server-side cipher whose fallback is Amthal's own mark. Pass yours
   * and it becomes the splash's mark; omit it and the beacon below is the mark instead. The two
   * are deliberately exclusive — a logo and an animated mark on the same screen compete.
   */
  logo?: React.ReactNode;
  /** Resolved theme — the caller has already turned 'system' into a real value. */
  dark?: boolean;
  /** Shown under the mark. Usually the tenant's company name. */
  title?: string;
  /** Overrides the default caption. */
  caption?: string;
}

/**
 * The SDK's default wait screen.
 *
 * This is the screen a user actually stares at: it covers the manifest fetch, the page load
 * and the bridge handshake, and only lifts once the portal reports `ready`. It used to be a
 * bare `ActivityIndicator` tinted a hardcoded Tailwind blue — which meant every tenant, on
 * every brand, waited on somebody else's colour. Hosts worked around that by passing
 * `renderLoading`, which is why this needed to be good enough that they no longer have to.
 *
 * Design constraints, all of which come from shipping to many companies at once:
 *
 *  - **No logo.** The SDK cannot know one, and the portal's own logo is unreliable enough that
 *    the web side refuses to use it too. Pass `title` if you want an identity moment.
 *  - **One colour in, everything derived.** Every tone here is the brand at an opacity over a
 *    neutral surface, so it is correct for a maroon brand and a near-black one alike, with no
 *    per-tenant tuning and no hue assumptions.
 *  - **Full bleed.** A small mark centred on a sheet of white is the visual signature of a
 *    cheap app; the field fills the screen.
 *  - **Cheap.** This renders while the WebView is doing its heaviest work. Only `opacity` and
 *    `transform` animate, and both run on the native driver so JS congestion cannot stutter it.
 */
export function PortalSplash({
  brandColor,
  dark = false,
  title,
  caption,
  logo,
}: PortalSplashProps): React.ReactElement {
  const surface = dark ? '#111418' : '#ffffff';
  const onSurface = dark ? '#f3f4f6' : '#1a1a1a';
  const subtle = dark ? '#9ca3af' : '#6b7280';
  const trackBg = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  // Fall back to the surface's own foreground rather than inventing a colour.
  const accent = (brandColor ?? onSurface) as ColorValue;

  const [slow, setSlow] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) setReduceMotion(v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // Three rings emitted from a solid core. Nothing rotates: a rotating arc is the universal
  // tell of a web loader, and the point of this screen is that it should not read as one.
  const rings = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loops = rings.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 930),
          Animated.timing(v, {
            toValue: 1,
            duration: 2800,
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
            useNativeDriver: true,
          }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduceMotion, rings]);

  // The travelling hairline. One value, native driver, so a congested JS thread — which is
  // exactly what is happening behind this screen — cannot stutter it.
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1900,
        easing: Easing.bezier(0.65, 0.02, 0.35, 1),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep]);
  // Starts PARTLY on the track, not fully off it. Travelling the bar's own width before it
  // appears leaves the track empty for roughly a third of every loop, which reads as stalled —
  // the opposite of what an indeterminate bar is for.
  const sweepX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-TRACK_W * 0.42, TRACK_W],
  });

  const text = caption ?? (slow ? 'Still working — the connection is slow right now' : 'Loading…');

  const ringStyles = useMemo(
    () =>
      rings.map((v, i) =>
        reduceMotion
          ? // A posed still, not a dead screen: three parked radii still read as a drawn mark.
            { opacity: [0.5, 0.28, 0.14][i], transform: [{ scale: [0.52, 0.76, 1][i] }] }
          : {
              opacity: v.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0.55, 0] }),
              transform: [
                { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }) },
              ],
            },
      ),
    [rings, reduceMotion],
  );

  return (
    <View
      style={[styles.root, { backgroundColor: surface }]}
      accessibilityRole="progressbar"
      accessibilityLabel={text}
    >
      {/* The field.
          React Native has no radial gradient without pulling in a native dependency, and a
          single flat circle shows its edge as a visible arc across the screen — which reads as
          a rendering artefact, not as depth. Stacking a few concentric circles at descending
          opacity approximates the falloff: each step is ~2%, far below the threshold where
          banding is perceptible, and the outermost is large enough that its own edge sits
          off-screen on a phone. */}
      {WASH_LAYERS.map((layer, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            styles.wash,
            {
              width: layer.size,
              height: layer.size,
              borderRadius: layer.size / 2,
              top: -layer.size * 0.42,
              left: -layer.size * 0.3,
              backgroundColor: accent,
              opacity: layer.opacity * (dark ? 1.35 : 1),
            },
          ]}
        />
      ))}

      <View style={styles.stage}>
        {logo ? (
          <View style={styles.logo}>{logo}</View>
        ) : (
          <View style={styles.beacon}>
            {ringStyles.map((s, i) => (
              <Animated.View
                key={i}
                style={[styles.ring, { borderColor: accent }, s as never]}
              />
            ))}
            <View style={[styles.core, { backgroundColor: accent }]} />
          </View>
        )}

        {title ? <Text style={[styles.title, { color: onSurface }]}>{title}</Text> : null}
        <Text style={[styles.caption, { color: subtle }]}>{text}</Text>

        {/* The motion. A travelling hairline rather than a spinner: a rotating arc is the
            universal tell of a web loader, and this screen exists to not read as one. */}
        <View style={[styles.track, { backgroundColor: trackBg }]}>
          <Animated.View
            style={[
              styles.bar,
              { backgroundColor: accent },
              reduceMotion
                ? { width: '100%', opacity: 0.45 }
                : { transform: [{ translateX: sweepX }] },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  wash: { position: 'absolute' },
  stage: { alignItems: 'center', paddingHorizontal: 24 },
  logo: { alignItems: 'center', justifyContent: 'center' },
  track: {
    marginTop: 22,
    width: TRACK_W,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  bar: { width: '42%', height: '100%', borderRadius: 999 },
  beacon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 72, height: 72, borderRadius: 36, borderWidth: 1.5 },
  core: { width: 14, height: 14, borderRadius: 7 },
  title: { marginTop: 20, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  caption: { marginTop: 10, fontSize: 15, textAlign: 'center' },
});
