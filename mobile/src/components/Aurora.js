import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { useTheme } from "../lib/theme";

/**
 * Living aurora background: three drifting colour glows plus a twinkling
 * star field (dark theme). Everything runs on the native driver.
 */
function Glow({ color, size, from, to, duration }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const id = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <Animated.View style={[styles.glow, { width: size, height: size, transform: [{ translateX }, { translateY }, { scale }] }]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity="1" />
            <Stop offset="100%" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

function Star({ x, y, size, delay, duration }) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(o, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.1, duration, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [o, delay, duration]);
  return <Animated.View style={[styles.star, { left: x, top: y, width: size, height: size, opacity: o }]} />;
}

export default function Aurora({ stars = true, intensity = 1 }) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();

  const starList = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        key: i,
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() < 0.2 ? 2.5 : 1.5,
        delay: Math.random() * 3000,
        duration: 1600 + Math.random() * 2600,
      })),
    [width, height]
  );

  const big = Math.max(width, height) * 0.9;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
      <View style={[StyleSheet.absoluteFill, { opacity: intensity }]}>
        <Glow color={theme.glows[0]} size={big} from={{ x: -big * 0.45, y: -big * 0.45 }} to={{ x: -big * 0.25, y: -big * 0.3 }} duration={9000} />
        <Glow color={theme.glows[1]} size={big * 0.85} from={{ x: width - big * 0.4, y: height * 0.55 }} to={{ x: width - big * 0.6, y: height * 0.45 }} duration={11000} />
        <Glow color={theme.glows[2]} size={big * 0.7} from={{ x: -big * 0.2, y: height * 0.35 }} to={{ x: width * 0.1, y: height * 0.25 }} duration={13000} />
      </View>
      {stars && theme.mode === "dark" && starList.map((s) => <Star key={s.key} {...s} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", left: 0, top: 0 },
  star: { position: "absolute", borderRadius: 2, backgroundColor: "#FFFFFF" },
});
