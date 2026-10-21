const { describe, test } = require("node:test");
const expect = require("./expect");
const { applyClientFolder } = require("../utils/clientFolder");

describe("Client folder for hosts without a root setting", () =>
{
    test("blank folder changes nothing", () =>
    {
        expect(applyClientFolder({ folder: "", buildCommand: "npm run build", outputDir: "build" })).toEqual({ buildCommand: "npm run build", outputDir: "build" });
    });

    test("builds inside the folder and reads the output from it", () =>
    {
        const r = applyClientFolder({ folder: "client/", buildCommand: "", outputDir: "" });
        expect(r.buildCommand).toBe("cd client && npm install && npm run build");
        expect(r.outputDir).toBe("client/dist");
    });

    test("keeps an output directory that is already inside the folder", () =>
    {
        expect(applyClientFolder({ folder: "web", buildCommand: "npm run build", outputDir: "web/out" }).outputDir).toBe("web/out");
        expect(applyClientFolder({ folder: "web", buildCommand: "npm run build", outputDir: "out" }).outputDir).toBe("web/out");
    });

    test("refuses paths that leave the repository", () =>
    {
        expect(applyClientFolder({ folder: "../secrets" }).error).toBeTruthy();
        expect(applyClientFolder({ folder: "/etc" }).error).toBeTruthy();
        expect(applyClientFolder({ folder: "a;rm -rf /" }).error).toBeTruthy();
    });
});
