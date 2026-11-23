import { generateKeyPairSync } from "node:crypto";
import { Probot } from "probot";
import { describe, expect, it } from "vitest";
import mergeWarden from "../src/index.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

interface Call {
  route: string;
  started: number;
  finished?: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fakeGitHub(permission: string) {
  const calls: Call[] = [];
  let clock = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    const call: Call = { route, started: clock++ };
    calls.push(call);
    await new Promise((resolve) => setTimeout(resolve, 5));
    call.finished = clock++;
    if (route.endsWith("/access_tokens"))
      return json(201, { token: "t", expires_at: "2999-01-01T00:00:00Z" });
    if (route.endsWith("/permission")) return json(200, { permission });
    if (route.endsWith("/reactions")) return json(201, { id: 42, content: "eyes" });
    if (route.includes("/reactions/")) return new Response(null, { status: 204 });
    if (route === "GET /app") return json(200, { id: 1, slug: "merge-warden" });
    return json(404, { message: "Not Found" });
  };
  return { calls, fetch };
}

async function deliver(permission: string, body = "/merge-warden grade") {
  const github = fakeGitHub(permission);
  const probot = new Probot({
    appId: 1,
    privateKey,
    logLevel: "fatal",
    request: { fetch: github.fetch },
  });
  await probot.load(mergeWarden);
  await probot
    .receive({
      id: "1",
      name: "issue_comment",
      payload: {
        action: "created",
        installation: { id: 7 },
        repository: { name: "r", owner: { login: "o" } },
        issue: { number: 3, pull_request: {} },
        comment: { id: 99, body, user: { login: "dev", type: "User" } },
      },
    } as never)
    .catch(() => {});
  return github.calls.filter((call) => !call.route.endsWith("/access_tokens"));
}

const isReaction = (call: Call) => call.route === "POST /repos/o/r/issues/comments/99/reactions";

describe("grade command acknowledgement", () => {
  it("sends the 👀 reaction before waiting on any other GitHub call", async () => {
    const calls = await deliver("write");
    const reaction = calls.find(isReaction);
    expect(reaction).toBeDefined();
    const finishedFirst = calls.filter(
      (call) => call !== reaction && call.finished! < reaction!.started,
    );
    expect(finishedFirst.map((call) => call.route)).toEqual([]);
  });

  it("removes the 👀 reaction and does not grade for a commenter without write access", async () => {
    const calls = await deliver("read");
    expect(calls.map((call) => call.route)).toContain(
      "DELETE /repos/o/r/issues/comments/99/reactions/42",
    );
    expect(calls.some((call) => call.route.includes("/contents/"))).toBe(false);
  });

  it("makes no GitHub call for a comment that is not the command", async () => {
    expect(await deliver("write", "looks good")).toEqual([]);
  });
});
