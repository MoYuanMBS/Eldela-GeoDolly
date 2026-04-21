import test from "node:test";
import assert from "node:assert/strict";

import {
  bridgeResponseSchemaFn,
  bridgeRequestSchemaFn,
  locSearchQueryReqSchema,
  locSearchReplySchema,
  locSearchReplyRawSchema,
} from "../../src/utils/bridge-models.ts";

test("locSearchQueryReqSchema accepts the Python-aligned request shape", () => {
  const payload = {
    queries: [
      {
        query: "Toronto Pearson Airport",
        country_codes: ["ca"],
      },
    ],
  };

  const parsed = locSearchQueryReqSchema.parse(payload);

  assert.deepEqual(parsed, payload);
});

test("bridgeRequestSchemaFn rejects the old flat request shape", () => {
  const requestEnvelopeSchema = bridgeRequestSchemaFn(locSearchQueryReqSchema);

  assert.throws(() => {
    requestEnvelopeSchema.parse({
      action: "search_location",
      query: "Toronto Pearson Airport",
      country_codes: ["ca"],
    });
  });
});

test("locSearchReplySchema rejects candidate geojson", () => {
  assert.throws(() => {
    locSearchReplySchema.parse({
      status: "needs_confirmation",
      session_id: "abc123",
      query: "Toronto Pearson Airport",
      candidates: [
        {
          index: 1,
          name: "Toronto Pearson International Airport",
          geojson: {
            type: "Polygon",
            coordinates: [],
          },
        },
      ],
    });
  });
});

test("bridgeResponseSchemaFn parses the Python response envelope", () => {
  const responseEnvelopeSchema = bridgeResponseSchemaFn(locSearchReplyRawSchema);

  const parsed = responseEnvelopeSchema.parse({
    ok: true,
    data: {
      status: "needs_confirmation",
      session_id: "abc123",
      query: "Toronto Pearson Airport",
      candidates: [],
      instruction: "Reply with JSON containing session_id and selected_indices.",
      message: null,
    },
    error: null,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data?.status, "needs_confirmation");
});
