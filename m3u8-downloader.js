#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const {exec} = require("child_process");

const m3u8URL = process.argv[2];
const baseName = process.argv[3];

const config = require(`${process.cwd()}/config.json`);
const cookie = config["cookie"];
const workers = config["workers"] || 1;

const get = (url, headers = {}) => {
  const opts = {
    "method": "GET",
    "timeout": 1500,
    "headers": {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.5001.63 Safari/537.36."
    }
  };
  for (const [k, v] of Object.entries(headers)) {
    opts["headers"][k.toLowerCase()] = v;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = https.request(url, opts, (res) => {
      if (res.statusCode != 200) {
        reject(new Error(`Request failed: ${res.statusCode}`));
        // Consume response data to free up memory.
        res.resume();
        return;
      }
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
    }).on("error", reject);
    req.end();
  });
};

const getM3u8 = async (m3u8URL, cookie) => {
  const headers = {};
  if (cookie != null) {
    headers["cookie"] = cookie;
  }
  const buffer = await get(m3u8URL, headers);
  return buffer.toString("utf8");
};

const getFragments = (m3u8) => {
  const lines = m3u8.trim().split("\n");
  const fragments = lines.filter((line) => {
    return !line.startsWith("#");
  });
  // Check if there is a mp4 header file.
  for (const line of lines) {
    if (line.includes("EXT-X-MAP:URI")) {
      const value = line.split("=")[1]
      // Remove quotas.
      fragments.unshift(value.substring(1, value.length - 1));
      break;
    }
  }
  return fragments;
};

const getTasks = (fragments, baseURL, baseName) => {
  return fragments.map((fragment) => {
    if (fragment.startsWith('/')) {
      fragment = fragment.substring(1);
    }
    return {
      "url": `${baseURL}/${fragment}`,
      "filename": path.join(baseName, path.posix.basename(fragment))
    };
  });
};

const getInputList = (fragments) => {
  return fragments.map((fragment) => {
    return `file '${path.posix.basename(fragment)}'`;
  });
};

const concatFragments = (fragments, baseName) => {
  for (const fragment of fragments) {
    const file = path.join(baseName, path.posix.basename(fragment));
    console.log(`Piping ${file}`);
    const buffer = fs.readFileSync(file);
    fs.appendFileSync(`${baseName}.mp4`, buffer, {"encoding": null});
  }
};

const parallelDownload = (tasks, opts = {}) => {
  opts["workers"] = opts["workers"] || 1;
  console.log(`Workers length: ${opts["workers"]}`);

  const unfinished = [];
  const workerPool = [];
  const iterator = tasks[Symbol.iterator]();

  const workerNext = async (i) => {
    const nextTask = iterator.next();
    if (nextTask.done)
      return null;
    const task = nextTask.value;
    console.log(`Worker ${i} starts to download ${task["filename"]} from ${task["url"]}`);
    try {
      const headers = {};
      if (opts["cookie"] != null) {
        headers["cookie"] = opts["cookie"];
      }
      const buffer = await get(task["url"], headers);
      await fsp.writeFile(task["filename"], buffer);
    } catch (error) {
      console.error(error);
      unfinished.push(task);
    }
    return workerNext(i);
  };

  for (let i = 0; i < opts["workers"]; ++i) {
    const worker = workerNext(i);
    if (worker != null) {
      workerPool.push(worker);
    } else {
      break;
    }
  }

  return Promise.all(workerPool).then(() => {return unfinished;});
};

const main = async () => {
  const m3u8 = await getM3u8(m3u8URL);
  const fragments = getFragments(m3u8);
  // Some website just put file names of ts in m3u8 file and they share the dir
  // of the m3u8. But others like twitter use absolute name in m3u8 and only
  // shares origin.
  let baseURL = m3u8URL.substring(0, m3u8URL.lastIndexOf("/"));
  if (path.posix.isAbsolute(fragments[0])) {
    baseURL = new URL(m3u8URL).origin;
  }
  const tasks = getTasks(fragments, baseURL, baseName);
  await fsp.mkdir(baseName);
  let unfinished = tasks;
  do {
    unfinished = await parallelDownload(
      unfinished,
      {"workers": workers, "cookie": cookie}
    );
  } while (unfinished.length !== 0);

  if (path.posix.extname(fragments[0]) === ".ts") {
    console.log("Merging pieces with ffmpeg");
    await fsp.writeFile(
      path.join(baseName, `${baseName}.txt`),
      getInputList(fragments).join("\n"),
      "utf8"
    );
    // ffmpeg -f concat -i ${baseName}/${baseName}.txt -c:v copy -c:a copy ${baseName}.mp4
    exec(
      `ffmpeg -f concat -i ${path.join(baseName, `${baseName}.txt`)} -c:v copy -c:a copy ${baseName}.mp4`,
      (error, stdout, stderr) => {
        if (error != null) {
          console.error(`exec error: ${error}`);
          return;
        }
        if (stdout != null && stdout.length !== 0) {
          console.log(`stdout: ${stdout}`);
        }
        if (stderr != null && stderr.length !== 0) {
          console.error(`stderr: ${stderr}`);
        }
        console.log(`removing cache dir ${baseName}`);
        fsp.rm(baseName, {"recursive": true});
      }
    );
  } else {
    // Twitter uses fragment mp4 (m4s).
    console.log("Merging pieces with concatFragments");
    concatFragments(fragments, baseName);
    fsp.rm(baseName, {"recursive": true});
  }
};

main();
