import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, Text, View } from "react-native";
import { fx, nextDelay, robotFlight, sparks } from "../lib/fx";
import { useVault } from "../lib/vault";

let nextId = 1;
const MAX_ON_SCREEN = 3;

/* A robot flies across the screen, bobbing as it goes. */
function FlyingRobot({ flight, onDone }) {
  const { width } = Dimensions.get("window");
  const x = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
    Animated.timing(x, { toValue: 1, duration: Math.min(flight.seconds, 14) * 1000, easing: Easing.linear, useNativeDriver: true }).start(() => onDone());
  }, [x, bob, flight.seconds, onDone]);
  const from = flight.fromLeft ? -60 : width + 20;
  const to = flight.fromLeft ? width + 20 : -60;
  return (
    <Animated.View style={[styles.abs, { top: `${flight.top}%`, transform: [
      { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) },
      { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-flight.bob / 2, flight.bob / 2] }) },
      { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ["-5deg", "5deg"] }) },
      { scaleX: flight.fromLeft ? 1 : -1 },
    ] }]}>
      <Text style={{ fontSize: flight.size * 0.8 }}>🤖</Text>
    </Animated.View>
  );
}

/* A plane glides down and lands on a runway at the bottom of the screen. */
function LandingPlane({ onDone }) {
  const { width, height } = Dimensions.get("window");
  const t = useRef(new Animated.Value(0)).current;
  const runway = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(runway, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(t, { toValue: 1, duration: 4200, easing: Easing.bezier(0.3, 0.1, 0.45, 1), useNativeDriver: true }),
      Animated.timing(runway, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => onDone());
  }, [t, runway, onDone]);
  const ground = height - 118;
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.runway, { opacity: runway }]}><View style={styles.runwayLine} /></Animated.View>
      <Animated.View style={[styles.abs, { top: 0, transform: [
        { translateX: t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [-70, width * 0.55, width + 40] }) },
        { translateY: t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [height * 0.12, ground, ground] }) },
        { rotate: t.interpolate({ inputRange: [0, 0.6, 0.7, 1], outputRange: ["14deg", "8deg", "0deg", "0deg"] }) },
      ] }]}>
        <Text style={{ fontSize: 46 }}>🛬</Text>
      </Animated.View>
    </>
  );
}

/* A cartoon explosion with sparks. */
function Explosion({ x, y, big, onDone }) {
  const t = useRef(new Animated.Value(0)).current;
  const [parts] = useState(() => sparks(big ? 14 : 10));
  useEffect(() => { Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => onDone()); }, [t, onDone]);
  return (
    <View pointerEvents="none" style={[styles.abs, { left: x, top: y }]}>
      <Animated.Text style={{ position: "absolute", left: -30, top: -36, fontSize: big ? 80 : 56, opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1.3, 0.9] }) }] }}>💥</Animated.Text>
      {parts.map((p, i) => {
        const rad = (p.angle * Math.PI) / 180;
        return (
          <Animated.View key={i} style={{ position: "absolute", width: p.size, height: p.size, borderRadius: p.size, backgroundColor: p.color,
            opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.8, 0] }),
            transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * p.dist] }) }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(rad) * p.dist] }) }] }} />
        );
      })}
    </View>
  );
}

/*
 * Same idea as the website: robots fly by, planes land when you save, things blow up when something is deleted for good
 * or goes down. It never takes touches, stays off with "reduce motion" and can be switched off in Settings.
 */
export default function SkyFx() {
  const { prefs } = useVault();
  const [items, setItems] = useState([]);
  const [reduce, setReduce] = useState(false);
  const enabled = prefs?.fx !== false && !reduce;
  const add = useCallback((item) => setItems((l) => (l.length >= MAX_ON_SCREEN ? l : [...l, { id: nextId++, ...item }])), []);
  const remove = useCallback((id) => setItems((l) => l.filter((i) => i.id !== id)), []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const { width, height } = Dimensions.get("window");
    const off = fx.on((e) => {
      if (e.type === "robot") add({ kind: "robot", flight: robotFlight() });
      else if (e.type === "land") add({ kind: "plane" });
      else if (e.type === "boom") add({ kind: "boom", x: e.x ?? width / 2, y: e.y ?? height / 3, big: Boolean(e.big) });
    });
    const timers = [];
    const loop = (kind) => { timers.push(setTimeout(() => { add(kind === "plane" ? { kind: "plane" } : { kind: "robot", flight: robotFlight() }); loop(kind); }, nextDelay(kind))); };
    timers.push(setTimeout(() => add({ kind: "robot", flight: robotFlight() }), 3000));
    loop("robot"); loop("plane");
    return () => { off(); timers.forEach(clearTimeout); };
  }, [enabled, add]);

  if (!enabled || !items.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((it) => it.kind === "robot" ? <FlyingRobot key={it.id} flight={it.flight} onDone={() => remove(it.id)} />
        : it.kind === "plane" ? <LandingPlane key={it.id} onDone={() => remove(it.id)} />
        : <Explosion key={it.id} x={it.x} y={it.y} big={it.big} onDone={() => remove(it.id)} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute", left: 0 },
  runway: { position: "absolute", left: 0, right: 0, bottom: 84, height: 14, backgroundColor: "#242933" },
  runwayLine: { position: "absolute", left: 0, right: 0, top: 6, height: 2, borderTopWidth: 2, borderStyle: "dashed", borderColor: "#fff" },
});
