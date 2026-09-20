/**
 * `conversation.generate` — the expensive call, governed (AD-22, WS-R2,
 * WS-R3).
 *
 * AD-22 left open whether the generation call is registered or exempt, on the
 * grounds that governing the cheap call while leaving the expensive one
 * ungoverned is incoherent. It is registered, and its post-validator is
 * exactly the action → effect check WS-R3 demands: a read-only action that
 * comes back carrying a prompt is a boundary failure, not a judgment call.
 */
import { describe, expect, it } from "vitest";

import { READ_ONLY_ACTIONS, VERSION_WRITING_ACTIONS } from "../../src/conversation/actions.js";
import {
  CONVERSATION_GENERATE_ID,
  ConversationEnvelopeSchema,
  conversationGenerateBoundary,
  createEnvelopeStreamReader,
  generateValidators,
  parseEnvelope,
} from "../../src/conversation/generate.js";

const input = (action: string) => ({ action, system: "You are FORGE.", user: "do the thing" });

describe("the response envelope", () => {
  it("accepts a reply with no prompt change", () => {
    expect(ConversationEnvelopeSchema.safeParse({ reply: "here you go", prompt: null }).success).toBe(true);
  });

  it("rejects an envelope with no reply at all", () => {
    expect(ConversationEnvelopeSchema.safeParse({ reply: "", prompt: null }).success).toBe(false);
  });

  it("parses an envelope embedded in prose", () => {
    const parsed = parseEnvelope('Here:\n{"reply":"done","prompt":"new text"}\nthanks');
    expect(parsed).toEqual({ reply: "done", prompt: "new text" });
  });

  it("returns null — never a guess — when the answer is not an envelope", () => {
    expect(parseEnvelope("just prose, no JSON")).toBeNull();
  });

  it("treats a blank prompt string as no prompt", () => {
    expect(parseEnvelope('{"reply":"ok","prompt":"   "}')?.prompt).toBeNull();
  });
});

describe("action → effect post-validation (WS-R3)", () => {
  it("fails a read-only action that came back carrying a prompt", () => {
    for (const action of READ_ONLY_ACTIONS) {
      const problems = generateValidators.readOnlyActionWritesNoPrompt(
        input(action) as never,
        { reply: "sure", prompt: "a new prompt" } as never,
      );
      expect(problems, action).not.toEqual([]);
    }
  });

  it("passes a read-only action that changed nothing", () => {
    for (const action of READ_ONLY_ACTIONS) {
      expect(
        generateValidators.readOnlyActionWritesNoPrompt(input(action) as never, { reply: "sure", prompt: null } as never),
      ).toEqual([]);
    }
  });

  it("passes a version-writing action that produced a prompt", () => {
    for (const action of VERSION_WRITING_ACTIONS) {
      expect(
        generateValidators.readOnlyActionWritesNoPrompt(
          input(action) as never,
          { reply: "revised", prompt: "a new prompt" } as never,
        ),
      ).toEqual([]);
    }
  });
});

describe("boundary registration", () => {
  it("is registered under a stable id with a content-addressed key", () => {
    expect(conversationGenerateBoundary.id).toBe(CONVERSATION_GENERATE_ID);
    const key = conversationGenerateBoundary.cassetteKey(input("REVISE") as never);
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conversationGenerateBoundary.cassetteKey({ ...input("REVISE"), user: "other" } as never)).not.toBe(key);
  });

  it("keys differently for different actions over the same text", () => {
    expect(conversationGenerateBoundary.cassetteKey(input("REVISE") as never)).not.toBe(
      conversationGenerateBoundary.cassetteKey(input("CREATE") as never),
    );
  });
});

/**
 * V2-B — incremental envelope reading (WS-R10, WS-R11).
 *
 * The reader exists so a user sees text as it arrives. It is a PRESENTATION
 * device: `parseEnvelope` over the accumulated raw text stays the only thing
 * that decides what the turn produced. The property that matters most is
 * WS-R11 — the reader emits the two envelope fields and nothing else, so a
 * model that prefixes its answer with reasoning cannot leak it by streaming.
 */
describe("incremental envelope reading (WS-R10, WS-R11)", () => {
  function drain(chunks: readonly string[]): { reply: string; prompt: string } {
    const reader = createEnvelopeStreamReader();
    let reply = "";
    let prompt = "";
    for (const chunk of chunks) {
      for (const delta of reader.push(chunk)) {
        if (delta.field === "reply") reply += delta.text;
        else prompt += delta.text;
      }
    }
    return { reply, prompt };
  }

  it("emits reply and prompt text progressively", () => {
    const reader = createEnvelopeStreamReader();
    const first = reader.push('{"reply": "Hel');
    expect(first).toEqual([{ field: "reply", text: "Hel" }]);
    const second = reader.push('lo", "prompt": "You are');
    expect(second).toEqual([
      { field: "reply", text: "lo" },
      { field: "prompt", text: "You are" },
    ]);
  });

  it("reassembles identically however the stream is chopped", () => {
    const text = '{"reply": "Changed the DB section.", "prompt": "You are an agent.\\nBe brief."}';
    const whole = drain([text]);
    expect(whole).toEqual({ reply: "Changed the DB section.", prompt: "You are an agent.\nBe brief." });
    const perCharacter = drain([...text]);
    expect(perCharacter).toEqual(whole);
    const awkward = drain([text.slice(0, 41), text.slice(41, 42), text.slice(42)]);
    expect(awkward).toEqual(whole);
  });

  it("decodes escapes that straddle a chunk boundary", () => {
    expect(drain(['{"reply":"a\\', 'nb", "prompt":null}'])).toEqual({ reply: "a\nb", prompt: "" });
    expect(drain(['{"reply":"x\\u00', 'e9y","prompt":null}'])).toEqual({ reply: "xéy", prompt: "" });
    expect(drain(['{"reply":"q\\"', 'r","prompt":null}'])).toEqual({ reply: 'q"r', prompt: "" });
  });

  it("never emits anything outside the two envelope fields (WS-R11)", () => {
    // A field FORGE does not know is consumed and discarded. The shape of the
    // reader is the enforcement: there is no `field` value it could arrive as.
    const leaky =
      'Let me think. The user wants Postgres, so I will...\n' +
      '{"reasoning":"first I considered X then Y","thinking":"secret",' +
      '"reply":"Switched to PostgreSQL.","prompt":"Use PostgreSQL."}';
    expect(drain([leaky])).toEqual({ reply: "Switched to PostgreSQL.", prompt: "Use PostgreSQL." });
    const perCharacter = drain([...leaky]);
    expect(perCharacter).toEqual({ reply: "Switched to PostgreSQL.", prompt: "Use PostgreSQL." });
  });

  it("emits nothing at all for a response that never opens an envelope", () => {
    expect(drain(["I think the answer is 42. Here is my reasoning: ..."])).toEqual({ reply: "", prompt: "" });
  });

  it("keeps the raw text so parseEnvelope stays the authority", () => {
    const reader = createEnvelopeStreamReader();
    reader.push('{"reply":"ok",');
    reader.push('"prompt":"P"}');
    expect(reader.raw()).toBe('{"reply":"ok","prompt":"P"}');
    expect(parseEnvelope(reader.raw())).toEqual({ reply: "ok", prompt: "P" });
  });

  it("stops emitting once the envelope closes", () => {
    const reader = createEnvelopeStreamReader();
    reader.push('{"reply":"done","prompt":null}');
    expect(reader.push('{"reply":"a second envelope"}')).toEqual([]);
  });
});
