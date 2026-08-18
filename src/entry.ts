#!/usr/bin/env node
/**
 * Preload entry: neutralizes dotenv before any dependency loads.
 *
 * natural's optional storage backends (util/storage/*) call
 * `require('dotenv').config()` at import time, and modern dotenv prints an
 * "injected env" tip to STDOUT unless quieted. In an MCP stdio server stdout
 * is protocol traffic — any non-JSON line corrupts the stream. These env
 * vars make dotenv inert (quiet + a path that never exists) BEFORE the
 * dynamic import of the server.
 */
process.env.DOTENV_CONFIG_QUIET = "true";
process.env.DOTENV_CONFIG_PATH = "N/A";

const { main } = await import("./index.js");
await main();
