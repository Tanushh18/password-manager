import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useTheme } from "../lib/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export const verdict = (score) =>
  score >= 85 ? "Excellent" : score >= 70 ? "Healthy" : score >= 45 ? "Needs care" : "At risk";

/** Animated score ring (0-100) with a counting number in the middle. */
export default function HealthRing({ score = 0, size = 150, stroke = 12, loading }) {
  const { theme } = useTheme();
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = v.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(v, { toValue: loading ? 0 : score, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => v.removeListener(id);
  }, [score, loading, v]);

  const offset = v.interpolate({ inputRange: [0, 100], outputRange: [len, 0] });
  const tone = score >= 70 ? theme.ok : score >= 45 ? theme.warn : theme.danger;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={theme.accent3} />
            <Stop offset="0.5" stopColor={theme.accent} />
            <Stop offset="1" stopColor={theme.accent2} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.line} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={offset}
        />
      </Svg>
      <Text style={{ color: theme.heading, fontFamily: theme.font.displayHeavy, fontSize: size * 0.28, letterSpacing: -1 }}>
        {loading ? "…" : shown}
      </Text>
      <Text style={{ color: loading ? theme.textFaint : tone, fontFamily: theme.font.bodySemi, fontSize: size < 130 ? 8.5 : 10, letterSpacing: size < 130 ? 1 : 1.6, textTransform: "uppercase" }}>
        {loading ? "scanning" : verdict(score)}
      </Text>
    </View>
  );
}
