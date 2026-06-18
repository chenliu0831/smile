import { httpBaseFromWs } from "./datasetInfo";

test("derives the daemon HTTP base from a ws:// URL", () => {
  expect(httpBaseFromWs("ws://127.0.0.1:8893/ws/run")).toBe("http://127.0.0.1:8893/api/v1");
});

test("maps wss:// to https://", () => {
  expect(httpBaseFromWs("wss://host:9000/ws/run?token=x")).toBe("https://host:9000/api/v1");
});
