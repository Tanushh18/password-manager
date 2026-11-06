/**
 * Weather for the morning brief and the tablet dashboard, from Open-Meteo (free, no key). A city is looked up once
 * and its coordinates kept in the Home settings.
 */
const CODES = [
    [[0], "clear sky ☀️"], [[1, 2], "partly cloudy ⛅"], [[3], "cloudy ☁️"], [[45, 48], "fog 🌫️"],
    [[51, 53, 55, 56, 57], "drizzle 🌦️"], [[61, 63, 65, 66, 67, 80, 81, 82], "rain 🌧️"], [[71, 73, 75, 77, 85, 86], "snow ❄️"],
    [[95, 96, 99], "thunderstorm ⛈️"]
];
const describe = (code) => (CODES.find(([list]) => list.includes(Number(code))) || [null, "weather"])[1];

async function getJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw Object.assign(new Error(`Weather service answered HTTP ${r.status}`), { status: 502 });
    return r.json();
}

/** "Delhi" -> { city: "Delhi, India", lat, lon } or null. */
async function geocode(city) {
    const q = String(city || "").trim().slice(0, 80);
    if (!q) return null;
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(q)}`);
    const hit = (j.results || [])[0];
    return hit ? { city: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ").slice(0, 80), lat: hit.latitude, lon: hit.longitude } : null;
}

/** Now and today: { temp, feels, text, max, min, rainChance } or null when no place is set. */
async function forecast(w, timezone = "Asia/Kolkata") {
    if (!w || !Number.isFinite(w.lat) || !Number.isFinite(w.lon)) return null;
    const p = new URLSearchParams({
        latitude: String(w.lat), longitude: String(w.lon), timezone, forecast_days: "1",
        current: "temperature_2m,apparent_temperature,weather_code",
        daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    });
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?${p}`);
    const c = j.current || {}, d = j.daily || {};
    return {
        city: w.city || "", temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), text: describe(c.weather_code),
        max: Math.round((d.temperature_2m_max || [])[0]), min: Math.round((d.temperature_2m_min || [])[0]), rainChance: (d.precipitation_probability_max || [])[0] ?? null
    };
}

const line = (f) => (f ? `${f.city ? f.city + ": " : ""}${f.temp}°C (feels ${f.feels}°C), ${f.text}. Today ${f.min}–${f.max}°C${f.rainChance != null ? `, ${f.rainChance}% chance of rain` : ""}.` : "");

module.exports = { geocode, forecast, describe, line };
