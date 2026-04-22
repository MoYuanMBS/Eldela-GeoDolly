import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PythonBridgeError,
  buildBridgeRequestData,
  parseBridgeResponseData,
  resolvePythonExecutable,
  sanitizeSearchResponseForAI,
  unwrapBridgeResponseData,
} from "../../src/utils/python-bridge.ts";
import { locSearchReplyRawSchema } from "../../src/models/bridge-models.ts";

test("resolvePythonExecutable prefers PYTHON_PATH from the environment", () => {
  const originalPythonPath = process.env.PYTHON_PATH;
  process.env.PYTHON_PATH = "/custom/python";

  try {
    assert.equal(resolvePythonExecutable(), "/custom/python");
  } finally {
    if (originalPythonPath === undefined) {
      delete process.env.PYTHON_PATH;
    } else {
      process.env.PYTHON_PATH = originalPythonPath;
    }
  }
});

test("resolvePythonExecutable falls back to the project virtualenv", () => {
  const originalPythonPath = process.env.PYTHON_PATH;
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "geomcp-venv-"));
  const venvDir = path.join(tempDir, ".venv", "bin");
  const expectedExecutable = path.join(venvDir, "python");

  delete process.env.PYTHON_PATH;
  mkdirSync(venvDir, { recursive: true });
  writeFileSync(expectedExecutable, "#!/usr/bin/env python3\n");
  process.chdir(tempDir);

  try {
    assert.equal(resolvePythonExecutable(), expectedExecutable);
  } finally {
    process.chdir(originalCwd);
    if (originalPythonPath === undefined) {
      delete process.env.PYTHON_PATH;
    } else {
      process.env.PYTHON_PATH = originalPythonPath;
    }
  }
});

test("buildBridgeRequestData wraps payload into the Python envelope shape", () => {
  const payload = {
    queries: [
      {
        query: "Toronto Pearson Airport",
        country_codes: ["ca"],
      },
    ],
  };

  assert.deepEqual(buildBridgeRequestData("search_location", payload), {
    action: "search_location",
    data: payload,
  });
});

test("parseBridgeResponseData parses a successful Python stdout payload", () => {
  const stdout = JSON.stringify({
    ok: true,
    data: {
      status: "needs_confirmation",
      session_id: "abc123",
      query: "Toronto Pearson Airport",
      candidates: [],
      message: null,
    },
    error: null,
  });

  const parsed = parseBridgeResponseData(stdout, locSearchReplyRawSchema);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data?.session_id, "abc123");
});

test("unwrapBridgeResponseData returns inner data for a successful envelope", () => {
  const data = {
    status: "needs_confirmation" as const,
    session_id: "abc123",
    query: "Toronto Pearson Airport",
    candidates: [],
    message: null,
  };

  const unwrapped = unwrapBridgeResponseData({
    ok: true,
    data,
    error: null,
  });

  assert.deepEqual(unwrapped, data);
});

test("unwrapBridgeResponseData throws PythonBridgeError for Python-side failures", () => {
  assert.throws(
    () =>
      unwrapBridgeResponseData({
        ok: false,
        data: null,
        error: {
          code: "HTTP_ERROR",
          message: "failed to fetch location candidates from Nominatim",
          details: "Temporary failure in name resolution",
        },
      }),
    (error: unknown) =>
      error instanceof PythonBridgeError &&
      error.code === "HTTP_ERROR" &&
      error.message === "failed to fetch location candidates from Nominatim",
  );
});

test("sanitizeSearchResponseForAI strips geojson but keeps the rest of the candidate", () => {
  const rawResponse = {
    status: "needs_confirmation" as const,
    session_id: "abc123",
    query: "Toronto Pearson Airport",
    candidates: [
      {
        index: 1,
        osm_type: "way",
        name: "Toronto Pearson International Airport",
        display_name: "Toronto Pearson International Airport, Toronto, Ontario, Canada",
        lat: 43.6782236,
        lon: -79.6288047,
        category: null,
        type: "aerodrome",
        importance: 0.58,
        address: {
          city: "Toronto",
          country_code: "ca",
        },
        boundingbox: [43.6515, 43.7031, -79.667, -79.59],
        geojson: {
          type: "Polygon",
          coordinates: [],
        },
      },
    ],
    message: null,
  };

  const sanitized = sanitizeSearchResponseForAI(rawResponse);

  assert.equal(sanitized.candidates[0]?.name, "Toronto Pearson International Airport");
  assert.equal("geojson" in sanitized.candidates[0]!, false);
});
