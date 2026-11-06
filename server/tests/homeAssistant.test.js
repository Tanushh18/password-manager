const { describe, test } = require("node:test");
const expect = require("./expect");
const { parse, statusLine } = require("../utils/homeAssistant");

const tv = { kind: "tv", name: "TV", online: true, status: { screen: "on", app: { label: "Netflix" }, media: { title: "Dark", state: "playing" } } };
const hub = { kind: "hub", name: "Tablet", online: true, lan: [{ up: true }, { up: false }, { up: true }] };
const one = (text, devices = [tv, hub]) => parse(text, devices).commands;

describe("assistant: what each sentence does", () => {
    test("volume, in English and Hinglish", () => {
        expect(one("volume up")[0]).toEqual({ kind: "tv", type: "volume", args: { action: "up" } });
        expect(one("tv ki volume badhao")[0].args).toEqual({ action: "up" });
        expect(one("awaaz kam karo")[0].args).toEqual({ action: "down" });
        expect(one("mute the tv")[0].args).toEqual({ action: "mute" });
        expect(one("set volume to 35")[0].args).toEqual({ level: 35 });
        expect(parse("volume 400", [tv]).commands).toBe(undefined);   // out of range: not guessed
    });

    test("pause, play, next", () => {
        expect(one("pause")[0].args).toEqual({ action: "play_pause" });
        expect(one("movie roko")[0].args).toEqual({ action: "play_pause" });
        expect(one("play")[0].args).toEqual({ action: "play_pause" });
        expect(one("next song")[0].args).toEqual({ action: "next" });
        expect(one("pichla gaana")[0].args).toEqual({ action: "previous" });
    });

    test("opening apps picks the longest matching name", () => {
        expect(one("open netflix")[0].args.package).toBe("com.netflix.ninja");
        expect(one("youtube chalao")[0].args.package).toBe("com.google.android.youtube.tv");
        expect(one("zee news kholo")[0].args.package).toBe("com.zeenews.tv");
        expect(one("zee5 lagao")[0].args.package).toBe("com.graymatrix.did");
        expect(one("prime video khol")[0].args.package).toBe("com.amazon.amazonvideo.livingroom");
    });

    test("YouTube links and YouTube Music", () => {
        expect(one("play https://www.youtube.com/watch?v=abc123 on tv")[0]).toEqual({ kind: "tv", type: "open_url", args: { url: "https://www.youtube.com/watch?v=abc123" } });
        expect(one("https://youtu.be/xyz")[0].args.url).toBe("https://youtu.be/xyz");
        expect(one("open youtube music")[0].args.package).toBe("com.google.android.youtube.tvmusic");
        expect(one("open youtube")[0].args.package).toBe("com.google.android.youtube.tv");
        expect(parse("open https://evil.example.com/watch", [tv]).commands).toBe(undefined);
    });

    test("home, back, sync, wifi scan", () => {
        expect(one("tv home screen par jao")[0].args).toEqual({ key: "HOME" });
        expect(one("back")[0].args).toEqual({ key: "BACK" });
        expect(one("sync movies")[0].type).toBe("sync_now");
        expect(one("scan wifi")[0]).toEqual({ kind: "hub", type: "scan_now", args: {} });
    });

    test("status is answered from the last reports", () => {
        expect(parse("status", [tv, hub]).status).toBe(true);
        expect(statusLine([tv, hub])).toBe("TV is on, showing Netflix, playing “Dark”. Tablet: 2 devices on the Wi-Fi.");
        expect(statusLine([{ ...tv, online: false }])).toMatch(/off or not connected/);
        expect(statusLine([{ ...tv, status: { screen: "off" } }])).toMatch(/standby/);
        expect(statusLine([])).toBe("No devices added yet.");
    });

    test("what it does not understand, or has no device for, it does not act on", () => {
        expect(parse("tell me a joke", [tv]).commands).toBe(undefined);
        expect(parse("tell me a joke", [tv]).reply).toMatch(/did not understand/);
        expect(parse("volume up", []).reply).toMatch(/No TV/);
        expect(parse("", [tv]).commands).toBe(undefined);
        expect(parse("scan wifi", [tv]).commands).toBe(undefined);    // no hub added
    });
});
