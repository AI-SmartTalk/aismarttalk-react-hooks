const path = require("path");
const { createRequire } = require("module");
const fs = require("fs");
const http = require("http");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const sdkRequire = createRequire(path.join(root, "package.json"));

const { rollup } = sdkRequire("rollup");
const { nodeResolve } = sdkRequire("@rollup/plugin-node-resolve");
const commonjs = sdkRequire("@rollup/plugin-commonjs");
const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer");
(async () => {
  const bundles = {};
  for (const [name, esmPath] of Object.entries({
    ...(process.env.BASELINE_SDK_ESM
      ? { old: path.resolve(process.env.BASELINE_SDK_ESM) }
      : {}),
    fixed: path.join(root, "dist/index.esm.js"),
  })) {
    const entry = path.join(root, `.browser-resume-${name}.js`);
    fs.writeFileSync(
      entry,
      `import React from 'react';import {createRoot} from 'react-dom/client';import {useChatInstance} from '${esmPath}';function App(){const session=useChatInstance({chatModelId:new URLSearchParams(location.search).get('model')||'model',lang:'en',config:{apiUrl:location.origin}});window.session=session;return React.createElement('p',null,session.chatInstanceId+'|'+(session.error?.code||''));}createRoot(document.getElementById('root')).render(React.createElement(App));`,
    );
    const bundle = await rollup({
      input: entry,
      plugins: [
        nodeResolve({
          browser: true,
          preferBuiltins: false,
          dedupe: ["react", "react-dom"],
          rootDir: root,
        }),
        commonjs(),
      ],
      onwarn() {},
    });
    bundles[name] = (await bundle.generate({ format: "iife" })).output[0].code;
    await bundle.close();
    fs.unlinkSync(entry);
  }
  let buggy = false,
    calls = 0,
    creates = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(bundles[server.variant]);
    }
    if (req.url === "/api/chat/createInstance") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      calls++;
      let id = b.chatInstanceId;
      if (!id || buggy) id = `conversation-${++creates}`;
      await new Promise((r) => setTimeout(r, 20));
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ chatInstanceId: id }));
    }
    res.end(
      '<div id="root"></div><script>window.process={env:{NODE_ENV:"production"}}</script><script src="/bundle.js"></script>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ headless: true });
  const reports = [];
  try {
    for (const [variant, broken] of [
      ...(bundles.old ? [["old", true]] : []),
      ["fixed", true],
      ["fixed", false],
    ]) {
      buggy = broken;
      calls = 0;
      creates = 0;
      server.variant = variant;
      const context = await browser.createBrowserContext();
      const a = await context.newPage(),
        b = await context.newPage();
      a.on("pageerror", (e) => console.error(e.stack));
      b.on("pageerror", (e) => console.error(e.message));
      console.log("scenario", variant, broken);
      if (broken) {
        await a.goto(url);
        await new Promise((r) => setTimeout(r, 300));
        console.log(
          "first-state",
          await a.evaluate(() => ({
            state: window.session && {
              id: window.session.chatInstanceId,
              error: window.session.error?.message,
            },
            body: document.body.innerText,
          })),
          calls,
        );
        await a.waitForFunction(() => window.session?.chatInstanceId, {
          timeout: 5000,
          polling: 100,
        });
        await b.goto(url);
      } else await Promise.all([a.goto(url), b.goto(url)]);
      await new Promise((r) => setTimeout(r, 1000));
      const first = calls;
      await new Promise((r) => setTimeout(r, 1500));
      const end = calls;
      const states = await Promise.all(
        [a, b].map((p) =>
          p.evaluate(() => ({
            id: window.session.chatInstanceId,
            error: window.session.error?.code,
          })),
        ),
      );
      reports.push({
        variant,
        broken,
        initialCalls: first,
        laterCalls: end,
        creates,
        states,
      });
      console.log("observed", JSON.stringify(reports.at(-1)));
      if (variant === "old") assert(end > first + 5);
      if (variant === "fixed") {
        assert.equal(first, end);
        if (broken)
          assert.equal(states[1].error, "CONVERSATION_RESUME_MISMATCH");
        else {
          assert(states[0].id);
          assert.equal(states[0].id, states[1].id);
          const previous = states[0].id;
          await a.reload();
          await new Promise((r) => setTimeout(r, 300));
          console.log(
            "reload",
            await a.evaluate(() => ({
              id: window.session?.chatInstanceId,
              error: window.session?.error?.message,
            })),
          );
          await a.waitForFunction(
            (id) => window.session?.chatInstanceId === id,
            { polling: 100 },
            previous,
          );
          await a.evaluate(() => window.session.getNewInstance());
          await new Promise((r) => setTimeout(r, 300));
          console.log(
            "reset",
            await Promise.all(
              [a, b].map((p) =>
                p.evaluate(() => ({
                  id: window.session?.chatInstanceId,
                  error: window.session?.error?.message,
                })),
              ),
            ),
          );
          await b.waitForFunction(
            (id) =>
              window.session?.chatInstanceId &&
              window.session.chatInstanceId !== id,
            { polling: 100 },
            previous,
          );
          assert.equal(
            await a.evaluate(() => window.session.chatInstanceId),
            await b.evaluate(() => window.session.chatInstanceId),
          );
          const idle = calls;
          await new Promise((r) => setTimeout(r, 1000));
          assert.equal(calls, idle);
        }
      }
      await context.close();
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(JSON.stringify(reports, null, 2));
    if (process.env.RESUME_REPORT_PATH)
      fs.writeFileSync(
        process.env.RESUME_REPORT_PATH,
        JSON.stringify(reports, null, 2),
      );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
