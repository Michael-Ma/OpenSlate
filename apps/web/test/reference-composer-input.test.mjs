import test from "node:test";
import assert from "node:assert/strict";
import { composerEnterAction } from "../src/reference-model.ts";
import { makeQuestionReply } from "../src/model.ts";

const input = {
  disabled: false,
  pending: false,
  allowReferences: true,
  pickerOpen: false,
  hasOption: false,
  modified: false,
};
test("question replies submit with Enter while literal mentions remain in the answer", () => {
  const action = composerEnterAction({
    ...input,
    allowReferences: false,
    pickerOpen: true,
    hasOption: true,
  });
  assert.equal(
    action,
    "send",
    "a reply cannot be intercepted by a hidden reference picker",
  );
  const text = "Use @Shot 1.2 for the ending.";
  const reply = makeQuestionReply(
    "project",
    {
      id: "question",
      requestId: "request",
      state: "pending",
      questions: [
        {
          id: "choice",
          header: "Ending",
          question: "Which ending?",
          options: [],
        },
      ],
    },
    text,
    "reply-once",
  );
  assert.equal(reply.body.text, text);
  assert.equal(reply.body.replyToQuestionId, "question");
});
test("background work permits reference drafting but cannot submit a conflicting message", () => {
  assert.equal(
    composerEnterAction({
      ...input,
      disabled: true,
      pickerOpen: true,
      hasOption: true,
    }),
    "choose",
  );
  assert.equal(composerEnterAction({ ...input, disabled: true }), "none");
  assert.equal(
    composerEnterAction({
      ...input,
      disabled: true,
      pickerOpen: true,
      hasOption: true,
      modified: true,
    }),
    "none",
  );
  assert.equal(
    composerEnterAction({
      ...input,
      pending: true,
      pickerOpen: true,
      hasOption: true,
    }),
    "none",
    "an unresolved message keeps its frozen original text and references",
  );
});
test("modified Enter submits the draft rather than consuming a reference option", () => {
  assert.equal(
    composerEnterAction({
      ...input,
      pickerOpen: true,
      hasOption: true,
      modified: true,
    }),
    "send",
  );
  assert.equal(
    composerEnterAction({ ...input, pickerOpen: true, hasOption: true }),
    "choose",
  );
});
